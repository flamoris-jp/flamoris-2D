#include "flamoris2d_core.h"

#ifdef NDEBUG
#undef NDEBUG // Keep the conformance checks active in Release/CTest builds.
#endif
#include <cassert>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <cstdio>
#include <map>
#include <set>
#include <string>
#include <cmath>
#include <vector>
#include "picojson.h"
#include <unicode/uloc.h>

static std::string read_string(const fl2d_snapshot* s, uint32_t index, const char* field) {
    uint32_t length = 0;
    assert(fl2d_snapshot_issue_string(s, index, field, nullptr, 0, &length) == FL2D_BUFFER_TOO_SMALL);
    std::string value(length, '\0');
    assert(fl2d_snapshot_issue_string(s, index, field, value.data(), length, &length) == FL2D_OK);
    value.resize(length - 1);
    return value;
}

static void check_project_snapshots() {
    std::ifstream stream(FL2D_PROJECT_FIXTURES);
    assert(stream.good());
    picojson::value fixtures;
    assert(picojson::parse(fixtures, stream).empty());
    for (const auto& entry : fixtures.get<picojson::array>()) {
        const auto& fixture = entry.get<picojson::object>();
        const std::string json = fixture.at("projectJson").get<std::string>();
        fl2d_snapshot* snapshot = nullptr;
        assert(fl2d_snapshot_load(reinterpret_cast<const uint8_t*>(json.data()), static_cast<uint32_t>(json.size()), &snapshot) == FL2D_OK);
        assert(snapshot);
        int32_t schema; double width, height; uint32_t nodes, issues;
        assert(fl2d_snapshot_summary(snapshot, &schema, &width, &height, &nodes, &issues) == FL2D_OK);
        assert(schema == static_cast<int32_t>(fixture.at("project").get<picojson::object>().at("schemaVersion").get<double>()));
        std::multiset<std::string> actual, expected;
        for (uint32_t i = 0; i < issues; ++i) {
            actual.insert(read_string(snapshot, i, "code") + "|" + read_string(snapshot, i, "path") + "|" +
                read_string(snapshot, i, "entityId") + "|" + read_string(snapshot, i, "severity"));
        }
        for (const auto& issue : fixture.at("expected").get<picojson::array>()) {
            const auto& object = issue.get<picojson::object>();
            expected.insert(object.at("code").get<std::string>() + "|" + object.at("path").get<std::string>() + "|" +
                object.at("entityId").get<std::string>() + "|" + object.at("severity").get<std::string>());
        }
        if (actual != expected) {
            fprintf(stderr, "Project fixture %s disagrees with JS validation\n", fixture.at("name").get<std::string>().c_str());
            for (const auto& value : actual) fprintf(stderr, " native: %s\n", value.c_str());
            for (const auto& value : expected) fprintf(stderr, " JS:     %s\n", value.c_str());
            assert(false);
        }
        // Every fixture exercises the shared session admission path, including
        // valid populated rigs and warning-only Projects, not just snapshots.
        bool errors = false;
        for (const auto& issue : fixture.at("expected").get<picojson::array>())
            if (issue.get<picojson::object>().at("severity").get<std::string>() == "error") errors = true;
        fl2d_session* admitted = nullptr;
        const auto admission = fl2d_session_create(reinterpret_cast<const uint8_t*>(json.data()),
            static_cast<uint32_t>(json.size()), &admitted);
        assert(admission == (errors ? FL2D_PROJECT_INVALID : FL2D_OK));
        assert(errors ? admitted == nullptr : admitted != nullptr);
        fl2d_session_destroy(admitted);
        uint32_t length = 0;
        assert(fl2d_snapshot_string(snapshot, "rootId", nullptr, 0, &length) == FL2D_BUFFER_TOO_SMALL);
        std::string root(length, '\0');
        assert(fl2d_snapshot_string(snapshot, "rootId", root.data(), length, &length) == FL2D_OK);
        assert(fl2d_snapshot_node_string(snapshot, root.c_str(), "kind", nullptr, 0, &length) == FL2D_BUFFER_TOO_SMALL);
        const auto& project = fixture.at("project").get<picojson::object>();
        for (const auto& [key, value] : project.at("scene").get<picojson::object>().at("nodes").get<picojson::object>()) {
            const auto& node = value.get<picojson::object>();
            const auto& id = node.at("id").get<std::string>();
            assert(fl2d_snapshot_node_string(snapshot, id.c_str(), "id", nullptr, 0, &length) == FL2D_BUFFER_TOO_SMALL);
            std::string found(length, '\0');
            assert(fl2d_snapshot_node_string(snapshot, id.c_str(), "id", found.data(), length, &length) == FL2D_OK);
            assert(found.c_str() == id);
            if (key != id) assert(fl2d_snapshot_node_string(snapshot, key.c_str(), "id", nullptr, 0, &length) == FL2D_INVALID_ARGUMENT);
            fl2d_node_state state{};
            assert(fl2d_snapshot_node_state(snapshot, id.c_str(), &state) == FL2D_OK);
            auto number = [](const picojson::value& v) { return v.is<double>() ? v.get<double>() : 0.0; };
            const auto& transform = node.at("transform").get<picojson::object>();
            const auto& position = transform.at("position").get<picojson::object>();
            const auto& scale = transform.at("scale").get<picojson::object>();
            const auto& pivot = transform.at("pivot").get<picojson::object>();
            assert(state.position_x == number(position.at("x")));
            if (position.find("y") != position.end()) assert(state.position_y == number(position.at("y")));
            assert(state.rotation == number(transform.at("rotation")));
            assert(state.scale_x == number(scale.at("x")) && state.scale_y == number(scale.at("y")));
            assert(state.pivot_x == number(pivot.at("x")) && state.pivot_y == number(pivot.at("y")));
            assert(state.visible == static_cast<int32_t>(node.at("visible").get<bool>()));
            assert(state.opacity == number(node.at("opacity")));
        }
        fl2d_snapshot_destroy(snapshot);
    }
    fl2d_snapshot* result = reinterpret_cast<fl2d_snapshot*>(1);
    const uint8_t invalid_utf8[] = {0xC0, 0xAF};
    assert(fl2d_snapshot_load(invalid_utf8, 2, &result) == FL2D_INVALID_UTF8 && result == nullptr);
    const uint8_t invalid_json[] = {'{'};
    assert(fl2d_snapshot_load(invalid_json, 1, &result) == FL2D_MALFORMED_JSON && result == nullptr);
    const uint8_t trailing[] = {'{', '}', 'x'};
    assert(fl2d_snapshot_load(trailing, 3, &result) == FL2D_MALFORMED_JSON && result == nullptr);
    assert(fl2d_snapshot_load(invalid_json, FL2D_SNAPSHOT_MAX_BYTES + 1, &result) == FL2D_INPUT_TOO_LARGE && result == nullptr);
}


static std::string session_text(const fl2d_session* session, bool history = false) {
    uint32_t length = 0;
    auto query = history ? fl2d_session_history_json : fl2d_session_project_json;
    assert(query(session, nullptr, 0, &length) == FL2D_BUFFER_TOO_SMALL);
    std::string result(length, '\0');
    assert(query(session, result.data(), length, &length) == FL2D_OK);
    result.resize(length - 1);
    return result;
}
static std::string session_error(const fl2d_session* session) {
    uint32_t length = 0;
    assert(fl2d_session_error(session, nullptr, 0, &length) == FL2D_BUFFER_TOO_SMALL);
    std::string result(length, '\0');
    assert(fl2d_session_error(session, result.data(), length, &length) == FL2D_OK);
    result.resize(length - 1);
    return result;
}
static picojson::value parsed(const std::string& text) {
    picojson::value result;
    assert(picojson::parse(result, text).empty());
    return result;
}
static void check_session(const picojson::object& root, bool full_admission) {
    auto initial = root.at("initial").serialize();
    fl2d_session* session = nullptr;
    assert(fl2d_session_create(reinterpret_cast<const uint8_t*>(initial.data()),
        static_cast<uint32_t>(initial.size()), &session) == FL2D_OK);
    assert(session);
    std::map<std::string, fl2d_prepared*> prepared;
    const auto& steps = root.at("steps").get<picojson::array>();
    const auto& expected = root.at("expected").get<picojson::array>();
    assert(steps.size() == expected.size());
    for (size_t i = 0; i < steps.size(); ++i) {
        const auto& step = steps[i].get<picojson::object>();
        const auto& want = expected[i].get<picojson::object>();
        const std::string op = step.at("op").get<std::string>();
        fl2d_status status = FL2D_OK;
        if (op == "transaction" || op == "prepare") {
            std::string input = step.at("commands").serialize();
            fl2d_prepared* p = nullptr;
            status = fl2d_session_prepare(session, reinterpret_cast<const uint8_t*>(input.data()),
                static_cast<uint32_t>(input.size()), step.at("label").get<std::string>().c_str(), &p);
            if (status == FL2D_OK) {
                if (op == "prepare") prepared[step.at("key").get<std::string>()] = p;
                else { status = fl2d_prepared_commit(p); fl2d_prepared_destroy(p); }
            } else assert(p == nullptr);
        } else if (op == "undo" || op == "redo") {
            fl2d_prepared* p = nullptr;
            status = op == "undo" ? fl2d_session_prepare_undo(session, &p) : fl2d_session_prepare_redo(session, &p);
            if (status == FL2D_OK) { status = fl2d_prepared_commit(p); fl2d_prepared_destroy(p); }
        } else if (op == "commit") status = fl2d_prepared_commit(prepared.at(step.at("key").get<std::string>()));
        else if (op == "markSaved") {
            fl2d_session_state state{};
            assert(fl2d_session_state_get(session, &state) == FL2D_OK);
            auto revision = step.count("revision") ? static_cast<int64_t>(step.at("revision").get<double>()) : state.current_revision;
            status = fl2d_session_mark_saved(session, revision);
        } else if (op == "replace") {
            std::string input = step.at("project").serialize();
            status = fl2d_session_replace(session, reinterpret_cast<const uint8_t*>(input.data()),
                static_cast<uint32_t>(input.size()), step.at("saved").get<bool>() ? 1 : 0);
        } else assert(false);
        const std::string actual_error = status == FL2D_OK ? "" : session_error(session);
        if (actual_error != want.at("error").get<std::string>()) {
            fprintf(stderr, "session step %zu (%s): got %s, expected %s\n", i, op.c_str(),
                actual_error.c_str(), want.at("error").get<std::string>().c_str());
            assert(false);
        }
        if (parsed(session_text(session)) != want.at("project")) {
            fprintf(stderr, "project mismatch at step %zu (%s)\n", i, op.c_str()); assert(false);
        }
        if (parsed(session_text(session, true)) != want.at("history")) {
            fprintf(stderr, "history mismatch at step %zu (%s)\n", i, op.c_str()); assert(false);
        }
        fl2d_session_state state{};
        assert(fl2d_session_state_get(session, &state) == FL2D_OK);
        const auto& expectation = want.at("state").get<picojson::object>();
        auto n = [&](const char* key) { return static_cast<int64_t>(expectation.at(key).get<double>()); };
        assert(state.revision_counter == n("revisionCounter") && state.current_revision == n("currentRevision") &&
            state.saved_revision == n("savedRevision") && state.undo_depth == static_cast<uint32_t>(n("undoDepth")) &&
            state.redo_depth == static_cast<uint32_t>(n("redoDepth")) &&
            state.history_depth == static_cast<uint32_t>(n("historyDepth")) &&
            state.dirty == static_cast<uint32_t>(expectation.at("dirty").get<bool>()));
    }
    if (full_admission) {
    // Shared validation rejects malformed names and disconnected graphs before mutation.
    {
        auto invalid = root.at("initial");
        auto& nodes = invalid.get<picojson::object>().at("scene").get<picojson::object>().at("nodes").get<picojson::object>();
        nodes.at("part_1").get<picojson::object>()["displayName"] = picojson::value("  ");
        std::string text = invalid.serialize();
        fl2d_session* rejected = reinterpret_cast<fl2d_session*>(1);
        assert(fl2d_session_create(reinterpret_cast<const uint8_t*>(text.data()),
            static_cast<uint32_t>(text.size()), &rejected) == FL2D_PROJECT_INVALID && rejected == nullptr);
    }
    {
        auto invalid = root.at("initial");
        auto& samples = invalid.get<picojson::object>().at("animation").get<picojson::object>()
            .at("deformationSamples").get<picojson::array>();
        samples.emplace_back(picojson::object{
            {"id", picojson::value("sample_invalid")},
            {"meshId", picojson::value("missing_mesh")},
            {"topologyId", picojson::value("missing_topology")},
            {"offsets", picojson::value(picojson::array{})},
        });
        const std::string text = invalid.serialize();
        fl2d_session* rejected = reinterpret_cast<fl2d_session*>(1);
        assert(fl2d_session_create(reinterpret_cast<const uint8_t*>(text.data()),
            static_cast<uint32_t>(text.size()), &rejected) == FL2D_PROJECT_INVALID && rejected == nullptr);
        const auto before_project = session_text(session);
        const auto before_history = session_text(session, true);
        fl2d_session_state before{}, after{};
        assert(fl2d_session_state_get(session, &before) == FL2D_OK);
        assert(fl2d_session_replace(session, reinterpret_cast<const uint8_t*>(text.data()),
            static_cast<uint32_t>(text.size()), 1) == FL2D_PROJECT_INVALID);
        assert(fl2d_session_state_get(session, &after) == FL2D_OK);
        assert(before_project == session_text(session) && before_history == session_text(session, true));
        assert(before.revision_counter == after.revision_counter && before.current_revision == after.current_revision &&
            before.saved_revision == after.saved_revision && before.undo_depth == after.undo_depth &&
            before.redo_depth == after.redo_depth && before.history_depth == after.history_depth && before.dirty == after.dirty);
    }
    {
        auto invalid = root.at("initial");
        auto& scene = invalid.get<picojson::object>().at("scene").get<picojson::object>();
        auto& nodes = scene.at("nodes").get<picojson::object>();
        // Keep parent/child links individually consistent but make a detached cycle.
        picojson::object a = nodes.at("part_1").get<picojson::object>();
        a["id"] = picojson::value("detached_a");
        a["parentId"] = picojson::value("detached_b");
        a["children"] = picojson::value(picojson::array{picojson::value("detached_b")});
        picojson::object b = a;
        b["id"] = picojson::value("detached_b");
        b["parentId"] = picojson::value("detached_a");
        b["children"] = picojson::value(picojson::array{picojson::value("detached_a")});
        nodes["detached_a"] = picojson::value(a);
        nodes["detached_b"] = picojson::value(b);
        std::string text = invalid.serialize();
        fl2d_session* rejected = reinterpret_cast<fl2d_session*>(1);
        assert(fl2d_session_create(reinterpret_cast<const uint8_t*>(text.data()),
            static_cast<uint32_t>(text.size()), &rejected) == FL2D_PROJECT_INVALID && rejected == nullptr);
    }
    // Failed full-domain replacement must preserve a populated history and
    // revision state for every JS-rejected Project in the conformance corpus.
    std::ifstream project_stream(FL2D_PROJECT_FIXTURES);
    picojson::value projects;
    assert(picojson::parse(projects, project_stream).empty());
    for (const auto& fixture : projects.get<picojson::array>()) {
        const auto& test = fixture.get<picojson::object>();
        bool errors = false;
        for (const auto& issue : test.at("expected").get<picojson::array>())
            if (issue.get<picojson::object>().at("severity").get<std::string>() == "error") errors = true;
        if (!errors) continue;
        const auto project = session_text(session), history = session_text(session, true);
        fl2d_session_state before{}, after{};
        assert(fl2d_session_state_get(session, &before) == FL2D_OK);
        const auto input = test.at("projectJson").get<std::string>();
        assert(fl2d_session_replace(session, reinterpret_cast<const uint8_t*>(input.data()),
            static_cast<uint32_t>(input.size()), 0) == FL2D_PROJECT_INVALID);
        assert(fl2d_session_state_get(session, &after) == FL2D_OK);
        assert(project == session_text(session) && history == session_text(session, true));
        assert(before.revision_counter == after.revision_counter && before.current_revision == after.current_revision &&
            before.saved_revision == after.saved_revision && before.undo_depth == after.undo_depth &&
            before.redo_depth == after.redo_depth && before.history_depth == after.history_depth && before.dirty == after.dirty);
    }
    }
    for (auto& [key, p] : prepared) { (void)key; fl2d_prepared_destroy(p); }
    fl2d_session_destroy(session);
}

static bool query_equal(const picojson::value& actual, const picojson::value& expected, bool geometry = false, bool sampling = false) {
    using Object = picojson::object; using Array = picojson::array;
    if (geometry && actual.is<double>() && expected.is<double>()) {
        const auto a = actual.get<double>(), b = expected.get<double>();
        return std::abs(a-b) <= 1e-12*std::max(1.0,std::max(std::abs(a),std::abs(b)));
    }
    if (actual.is<Object>() && expected.is<Object>()) {
        const auto& a = actual.get<Object>(); const auto& b = expected.get<Object>();
        if (a.size() != b.size()) return false;
        for (const auto& [key,value] : b)
            if (!a.count(key) || !query_equal(a.at(key),value,geometry || key == "worldTransform" ||
                (sampling && (key == "values" || key == "bindMatrix" || key == "poseMatrix" || key == "skinMatrix" ||
                key == "head" || key == "tip" || key == "positions" || key == "localDelta" || key == "end" || key == "joints")),sampling)) return false;
        return true;
    }
    if (actual.is<Array>() && expected.is<Array>()) {
        const auto& a = actual.get<Array>(); const auto& b = expected.get<Array>();
        if (a.size() != b.size()) return false;
        for (size_t i = 0; i < a.size(); ++i) if (!query_equal(a[i],b[i],geometry,sampling)) return false;
        return true;
    }
    return actual == expected;
}
static bool same_state(const fl2d_session_state& a, const fl2d_session_state& b) {
    return a.revision_counter == b.revision_counter && a.current_revision == b.current_revision &&
        a.saved_revision == b.saved_revision && a.undo_depth == b.undo_depth && a.redo_depth == b.redo_depth &&
        a.history_depth == b.history_depth && a.dirty == b.dirty;
}
static void check_queries() {
    using Value = picojson::value; using Object = picojson::object; using Array = picojson::array;
    std::ifstream stream(FL2D_QUERY_FIXTURES); assert(stream.good()); Value fixtures;
    assert(picojson::parse(fixtures,stream).empty());
    for (const auto& row : fixtures.get<Object>().at("fixtures").get<Array>()) {
        const auto& fixture = row.get<Object>();
        const std::string original_locale(uloc_getDefault()); UErrorCode locale_status = U_ZERO_ERROR;
        uloc_setDefault(fixture.at("locale").get<std::string>().c_str(),&locale_status); assert(U_SUCCESS(locale_status));
        const auto input = fixture.at("project").serialize(); fl2d_session* session = nullptr;
        assert(fl2d_session_create(reinterpret_cast<const uint8_t*>(input.data()),static_cast<uint32_t>(input.size()),&session) == FL2D_OK);
        const auto& scene = fixture.at("project").get<Object>().at("scene").get<Object>();
        const auto& root = scene.at("nodes").get<Object>().at(scene.at("rootId").get<std::string>()).get<Object>();
        const auto command = Value(Array{Value(Object{{"type",Value("scene.rename_node")},
            {"payload",Value(Object{{"nodeId",root.at("id")},{"displayName",root.at("displayName")}})}})}).serialize();
        // Populated undo, redo and history, dirty state, and an outstanding prepared
        // edit make hidden query mutations observable beyond Project equality.
        for (int i = 0; i < 2; ++i) {
            fl2d_prepared* edit = nullptr;
            assert(fl2d_session_prepare(session,reinterpret_cast<const uint8_t*>(command.data()),static_cast<uint32_t>(command.size()),"query setup",&edit) == FL2D_OK);
            assert(fl2d_prepared_commit(edit) == FL2D_OK); fl2d_prepared_destroy(edit);
        }
        fl2d_prepared* undo = nullptr;
        assert(fl2d_session_prepare_undo(session,&undo) == FL2D_OK && fl2d_prepared_commit(undo) == FL2D_OK);
        fl2d_prepared_destroy(undo);
        fl2d_prepared* pending = nullptr;
        assert(fl2d_session_prepare(session,reinterpret_cast<const uint8_t*>(command.data()),static_cast<uint32_t>(command.size()),"after queries",&pending) == FL2D_OK);
        assert(fl2d_session_mark_saved(session,-1) == FL2D_SAVED_REVISION_INVALID);
        const auto before_project = session_text(session), before_history = session_text(session,true), before_error = session_error(session);
        fl2d_session_state before{}; assert(fl2d_session_state_get(session,&before) == FL2D_OK);
        auto untouched = [&] {
            fl2d_session_state after{}; assert(fl2d_session_state_get(session,&after) == FL2D_OK);
            assert(same_state(before,after) && before_project == session_text(session) &&
                before_history == session_text(session,true) && before_error == session_error(session));
        };
        for (const auto& test : fixture.at("cases").get<Array>()) {
            const auto& object = test.get<Object>(); const auto request = object.at("request").serialize(); uint32_t length = 0;
            const auto& query_name = object.at("request").get<Object>().at("name");
            const bool sampled = query_name == Value("animation.sample_program") || query_name == Value("bone.get_evaluated_pose") ||
                query_name == Value("bone.get_two_bone_ik_pose") || query_name == Value("bone.solve_two_bone_ik") ||
                query_name == Value("skin.evaluate") || query_name == Value("mesh_form.evaluate");
            auto call = [&](char* buffer, uint32_t capacity, uint32_t* needed) {
                return fl2d_session_query_json(session,reinterpret_cast<const uint8_t*>(request.data()),static_cast<uint32_t>(request.size()),buffer,capacity,needed);
            };
            const auto measured = call(nullptr,0,&length);
            if (measured != FL2D_BUFFER_TOO_SMALL || !length) {
                fprintf(stderr,"Query sizing failed in %s: %s (status %d)\n",fixture.at("name").get<std::string>().c_str(),request.c_str(),measured);
                assert(false);
            }
            std::vector<char> buffer(static_cast<size_t>(length)+8,0x5a); uint32_t short_length = 0;
            assert(call(buffer.data(),length-1,&short_length) == FL2D_BUFFER_TOO_SMALL && short_length == length);
            for (const auto byte : buffer) assert(byte == 0x5a);
            assert(call(buffer.data(),length,&short_length) == FL2D_OK && short_length == length && buffer[length-1] == 0);
            for (size_t i = length; i < buffer.size(); ++i) assert(buffer[i] == 0x5a);
            const auto actual = parsed(std::string(buffer.data(),length-1));
            if (!query_equal(actual,object.at("expected"),false,sampled)) {
                fprintf(stderr,"Query mismatch in %s: %s\n native: %s\n JS: %s\n",
                    fixture.at("name").get<std::string>().c_str(),request.c_str(),actual.serialize().c_str(),object.at("expected").serialize().c_str());
                assert(false);
            }
            untouched();
        }
        for (const auto& name : fixtures.get<Object>().at("pending").get<Array>()) {
            const auto request = Value(Object{{"name",name}}).serialize(); uint32_t required = 999;
            assert(fl2d_session_query_json(session,reinterpret_cast<const uint8_t*>(request.data()),static_cast<uint32_t>(request.size()),nullptr,0,&required) == FL2D_QUERY_UNSUPPORTED && required == 0);
            untouched();
        }
        const std::pair<std::string,fl2d_status> rejected[] = {
            {"",FL2D_INVALID_ARGUMENT},{"{",FL2D_MALFORMED_JSON},{"[]",FL2D_INVALID_ARGUMENT},
            {"{}",FL2D_INVALID_ARGUMENT},{"{\"name\":1}",FL2D_INVALID_ARGUMENT},
            {"{\"name\":\"bone.get\",\"input\":null}",FL2D_INVALID_ARGUMENT},
            {"{\"name\":\"bone.get\",\"input\":[]}",FL2D_INVALID_ARGUMENT},
            {"{\"name\":\"bone.get\",\"extra\":{}}",FL2D_INVALID_ARGUMENT},
            {std::string(1,static_cast<char>(0xc0)),FL2D_INVALID_UTF8},
            {std::string(101,'[')+"0"+std::string(101,']'),FL2D_MALFORMED_JSON},
        };
        for (const auto& [request,status] : rejected) {
            uint32_t required = 99;
            assert(fl2d_session_query_json(session,reinterpret_cast<const uint8_t*>(request.data()),static_cast<uint32_t>(request.size()),nullptr,0,&required) == status && required == 0);
            untouched();
        }
        uint32_t required = 0;
        assert(fl2d_session_query_json(session,nullptr,0,nullptr,0,&required) == FL2D_INVALID_ARGUMENT);
        const uint8_t byte = 0;
        assert(fl2d_session_query_json(session,&byte,FL2D_SNAPSHOT_MAX_BYTES+1,nullptr,0,&required) == FL2D_INPUT_TOO_LARGE);
        assert(fl2d_session_query_json(nullptr,&byte,1,nullptr,0,&required) == FL2D_INVALID_ARGUMENT);
        assert(fl2d_session_query_json(session,&byte,1,nullptr,0,nullptr) == FL2D_INVALID_ARGUMENT);
        untouched();
        assert(fl2d_prepared_commit(pending) == FL2D_OK); fl2d_prepared_destroy(pending);
        fl2d_session_destroy(session);
        locale_status = U_ZERO_ERROR; uloc_setDefault(original_locale.c_str(),&locale_status); assert(U_SUCCESS(locale_status));
    }
}

static_assert(sizeof(fl2d_status) == sizeof(int32_t), "ABI status must be 32-bit");

int main() {
    int32_t major = 0, minor = -1;
    assert(fl2d_abi_version(&major, &minor) == FL2D_OK && major == 1 && minor == 4);
    assert(fl2d_abi_version(nullptr, &minor) == FL2D_INVALID_ARGUMENT);
    fl2d_engine* engine = nullptr;
    assert(fl2d_engine_create(&engine) == FL2D_OK && engine);
    fl2d_frame_rate result{};
    assert(fl2d_normalize_frame_rate(engine, 60000, 2002, &result) == FL2D_OK);
    assert(result.numerator == 30000 && result.denominator == 1001);
    assert(fl2d_normalize_frame_rate(engine, 9007199254740991LL, 1, &result) == FL2D_OK);
    assert(result.numerator == 9007199254740991LL && result.denominator == 1);
    assert(fl2d_normalize_frame_rate(engine, 0, 1, &result) == FL2D_INVALID_ARGUMENT);
    assert(fl2d_normalize_frame_rate(engine, 1, 0, &result) == FL2D_INVALID_ARGUMENT);
    assert(fl2d_normalize_frame_rate(engine, 9007199254740992LL, 1, &result) == FL2D_INVALID_ARGUMENT);
    assert(fl2d_normalize_frame_rate(nullptr, 1, 1, &result) == FL2D_INVALID_ARGUMENT);
    assert(fl2d_normalize_frame_rate(engine, 1, 1, nullptr) == FL2D_INVALID_ARGUMENT);
    fl2d_engine_destroy(engine);
    check_project_snapshots();
    check_queries();
    for (const auto& input : {std::pair<const char*, bool>{FL2D_SESSION_FIXTURES, true}, {FL2D_RIG_FIXTURES, false}, {FL2D_HIERARCHY_FIXTURES, false}, {FL2D_TEMPORAL_FIXTURES, false}, {FL2D_TRANSITION_FIXTURES, false}, {FL2D_MESH_FIXTURES, false}, {FL2D_SOURCE_FIXTURES, false}}) {
        std::ifstream stream(input.first); assert(stream.good()); picojson::value fixture;
        assert(picojson::parse(fixture, stream).empty());
        check_session(fixture.get<picojson::object>(), input.second);
    }
}
