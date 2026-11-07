#!/usr/bin/env python3
"""Recover the 0.1.1 native-to-Updater migration rejected before installation.

This operator-only path uses the installed Updater's journal, locks, installer and
setup methods. It never resets history or retries an installer with prior effects.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import stat
import subprocess
import sys
import time

APP = 'flamoris-2d-cli'
ROOT = Path('/srv/flamoris/apps') / APP
UNIT = 'flamoris2d-lime.service'
UNIT_PATH = Path('/etc/systemd/system') / UNIT
UPDATER_UNITS = ('flamoris-updater-supervisor.service',
                 'flamoris-updater.service', 'flamoris-updater-manager.service')
RUNTIME = Path('/var/lib/flamoris-updater/releases/ca1e54d96a84e2aaa2b83ac9ed9aa746a7a1266992510b404261b16d1d679277')
RECIPE = 'sha256:a9f193c8a74ecc3ba9290bd774f3960c18365d7937b0a79f9d3be537ae41482b'
IMAGE = 'sha256:35f546b898bc81239f11252419ba07532135af6b13c60cb69cf6ffdd0cd7dd14'
STAGE = 'inspect installed Updater'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, timeout=180).stdout


def trusted(path):
    require(path.is_absolute() and '..' not in path.parts, 'Invalid control path')
    for item in reversed((path, *path.parents)):
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                'Control path must be protected and administrator-owned')
    return path


def load_runtime():
    # Use the exact installed 1.0.15 bundle. No pip, new runtime or unit editing.
    trusted(RUNTIME / 'site-packages')
    unit = trusted(Path('/etc/systemd/system/flamoris-updater-manager.service'))
    starts = [line.split('=', 1)[1] for line in unit.read_text().splitlines() if line.startswith('ExecStart=')]
    require(len(starts) == 1, 'Unexpected Updater manager unit')
    args = shlex.split(starts[0])
    require(args[0] == str(RUNTIME / 'bin/flamoris-updater-service') and args.count('--config') == 1,
            'Updater runtime changed; inspect before recovery')
    config = trusted(Path(args[args.index('--config') + 1]))
    sys.path.insert(0, str(RUNTIME / 'site-packages'))
    from flamoris_updater_adapters.config import load
    from flamoris_updater_adapters.setup import BootstrapConfig
    from flamoris_updater_adapters.managed import Manager
    cfg = load(BootstrapConfig, str(config), root_only=True)
    require(Path(cfg.root) / APP == ROOT, 'Unexpected application namespace')
    manager = Manager(cfg.helper_state_directory, cfg.root, self_configuration=cfg)
    installed = manager.journal.get('self_installation', 'current')
    require(installed and (installed['release'], installed['runtime'], installed['phase']) ==
            ('1.0.15', str(RUNTIME), 'succeeded'), 'Updater installation changed')
    return manager


def plain_tree(root):
    require(root.is_dir() and not root.is_symlink(), 'Missing retained state')
    for path in (root, *root.rglob('*')):
        require(not path.is_symlink() and not path.is_mount() and
                (path.is_dir() or path.is_file()), 'Linked, mounted or special state needs inspection')


def fingerprints(root):
    plain_tree(root)
    result = {}
    for path in root.rglob('*'):
        if path.is_file():
            with path.open('rb') as stream:
                result[str(path.relative_to(root))] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return result


def restore_state(source, target):
    expected = fingerprints(source)
    require(target.is_dir() and not target.is_symlink() and not any(target.iterdir()),
            'New state must be empty before restoration')
    shutil.copytree(source, target, dirs_exist_ok=True)
    require(fingerprints(target) == expected, 'Retained state verification failed')
    for path in (target, *target.rglob('*')):
        os.chown(path, 10001, 10001)
        path.chmod(0o700 if path.is_dir() else 0o600)


def inspect_job(manager, identity):
    from flamoris_update_core.wire import decode, digest, dumps
    from flamoris_updater_adapters.managed import Recipe
    from flamoris_updater_adapters.install import DockerApplication
    from flamoris_updater_adapters.journal import Journal
    job = manager.journal.get('managed_job', identity)
    require(job and (job.get('application_id'), job.get('release'), job.get('action'),
                    job.get('phase'), job.get('step'), job.get('error'), job.get('from_release')) ==
            (APP, '0.1.1', 'install', 'recovery_required', 'install', 'not_empty', None),
            'Only an unchanged preflight-rejected 0.1.1 installation can be recovered')
    require(not manager.journal.get('managed_app', APP), 'Application is already managed')
    with manager.journal.connection() as db:
        others = db.execute("SELECT id FROM records WHERE kind='managed_job' AND id!=? "
                            "AND json_extract(payload,'$.phase') IN ('accepted','running','intent','recovery_required')",
                            (identity,)).fetchone()
    require(not others, 'Another Updater operation needs attention')
    raw = manager.journal.get('managed_recipe', identity)
    require(raw is not None, 'Missing original recipe')
    recipe = decode(Recipe, dumps({k:v for k,v in raw.items() if k != '_revision'}))
    require(digest(dumps(recipe)) == job['recipe'] == RECIPE, 'Original recipe changed')
    cfg = manager._profile(recipe, identity, reuse=True)
    app = cfg.applications[0]
    require(isinstance(app, DockerApplication) and app.database is None and
            app.container_name == APP and app.image_id == IMAGE, 'Unexpected application profile')
    require(Journal(Path(cfg.state_directory)).get('initial_install', APP) is None,
            'Installer already recorded effects; this recovery must not replay them')
    return job, cfg


def native_record():
    spec = importlib.util.spec_from_file_location('native_setup', Path(__file__).with_name('setup-2d-lime.py'))
    native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
    native.no_links(ROOT)
    record = ROOT / 'config/native-migration.json'
    native.no_links(record)
    migration = json.loads(record.read_text())
    require(migration.get('phase') == 'prepared' and migration.get('source') == native.SOURCE,
            'Prepared native migration is required')
    backup = Path(migration['backup'])
    require(backup.parent == ROOT and backup.name.startswith('native-backup-'), 'Unexpected backup path')
    native.no_links(backup)
    plain_tree(backup / 'state'); plain_tree(ROOT / 'state')
    require((ROOT / 'state/initial.fl2d').is_file() and (ROOT / 'state/connection.json').is_file(),
            'Retained startup project and connection settings are required')
    native.no_links(UNIT_PATH)
    require(UNIT_PATH.read_text() == native.UNIT_TEXT, 'Legacy service differs')
    return migration


def recover(manager, identity, apply=False):
    global STAGE
    from flamoris_updater_adapters.journal import exclusive, durable_write
    from flamoris_updater_adapters.diagnostics import recording, event, failure
    stopped = False
    try:
        with exclusive(manager.state / 'manager.lock'):
            job, cfg = inspect_job(manager, identity)
            migration = native_record()
            retired = ROOT.with_name(APP + '-native-retired-' + time.strftime('%Y%m%d-%H%M%S'))
            pointer = ROOT.with_name(APP + '-migration.json')
            require(not retired.exists() and not retired.is_symlink(), 'Retirement target already exists')
            require(not pointer.exists() and not pointer.is_symlink(), 'An earlier migration pointer needs inspection')
            result = {'application': APP, 'job': identity, 'applied': False, 'retained': str(retired)}
            if not apply:
                return result
            # No other active job exists, and the manager lock fences new effects.
            stopped = True
            STAGE = 'stop Updater services'
            command('systemctl', 'stop', *UPDATER_UNITS)
            for unit in UPDATER_UNITS:
                require(command('systemctl', 'show', unit, '--property=ActiveState', '--value').strip() == b'inactive',
                        'Updater units must be inactive')
            command('systemctl', 'stop', UNIT)
            command('systemctl', 'disable', UNIT)
            before = fingerprints(ROOT / 'state')
            with recording(manager.journal, identity, manager.secrets(identity)):
                event('migration.preflight_no_effects', 'verified', {'application':APP, 'retired':str(retired)})
                job.update(phase='intent', step='native_migration')
                manager.persist('managed_job', identity, job)
                try:
                    STAGE = 'retain native directory'
                    # Rename, never delete: includes binaries, backups, receipts and credentials.
                    ROOT.rename(retired)
                    durable_write(pointer, json.dumps({**result, 'phase':'retired'}).encode())
                    installer = manager.installer(cfg)
                    STAGE = 'verify empty installation destination'
                    installer.preflight()
                    # Initial-install absence was checked under the same lock. The official
                    # installer now creates its own durable intent before any application effect.
                    STAGE = 'install verified Docker package'
                    installer.apply(start=False)
                    app = installer.cfg.applications[0]
                    require(fingerprints(retired / 'state') == before, 'Retired state changed')
                    STAGE = 'restore and verify native state'
                    restore_state(retired / 'state', ROOT / 'state')
                    migration.update(legacyRoot=str(retired), backup=str(retired / Path(migration['backup']).name),
                                     phase='restored')
                    durable_write(ROOT / 'config/native-migration.json', json.dumps(migration).encode())
                    manager.save_layout(identity, app, installer)
                    manager.persist('managed_app', APP, {'application_id':APP, 'release':'0.1.1',
                                    'phase':'awaiting_setup', 'profile':app.model_dump(), 'previous':None,
                                    'older':[], 'job_id':identity})
                    job['recovered_failure'] = job.pop('failure', None)
                    job.pop('error', None)
                    job.update(phase='awaiting_setup', step=None)
                    manager.persist('managed_job', identity, job)
                    event('migration.state_restored', 'verified', {'files':len(before), 'retired':str(retired)})
                    durable_write(pointer, json.dumps({**result, 'phase':'restored'}).encode())
                except BaseException as error:
                    job.update(phase='recovery_required', error='outcome_unknown', failure=failure(error))
                    manager.persist('managed_job', identity, job)
                    raise
        STAGE = 'start and verify resident container'
        manager.start_setup(APP)
        manager.complete(APP)
        return {**result, 'applied':True, 'phase':'succeeded', 'hubVerification':'pending'}
    finally:
        if stopped:
            command('systemctl', 'start', *reversed(UPDATER_UNITS))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0 and socket.gethostname().split('.')[0] == 'lime', 'Run with sudo on LIME')
    print(json.dumps(recover(load_runtime(), args.job, args.apply)))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No subprocess stderr, environment values or private bundle contents.
        print('Recovery stopped at ' + STAGE + ': ' + (str(error) if isinstance(error, ValueError) else type(error).__name__))
        raise SystemExit(1)
