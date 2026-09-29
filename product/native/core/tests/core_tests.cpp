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
#include "picojson.h"

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
        const std::string json = fixture.at("project").serialize();
        fl2d_snapshot* snapshot = nullptr;
        assert(fl2d_snapshot_load(reinterpret_cast<const uint8_t*>(json.data()), static_cast<uint32_t>(json.size()), &snapshot) == FL2D_OK);
        assert(snapshot);
        int32_t schema; double width, height; uint32_t nodes, issues;
        assert(fl2d_snapshot_summary(snapshot, &schema, &width, &height, &nodes, &issues) == FL2D_OK);
        assert(schema == static_cast<int32_t>(fixture.at("project").get<picojson::object>().at("schemaVersion").get<double>()));
        std::multiset<std::string> actual, expected;
        for (uint32_t i = 0; i < issues; ++i) actual.insert(read_string(snapshot, i, "code") + "|" + read_string(snapshot, i, "path") + "|" + read_string(snapshot, i, "entityId"));
        for (const auto& issue : fixture.at("expected").get<picojson::array>()) {
            const auto& object = issue.get<picojson::object>();
            expected.insert(object.at("code").get<std::string>() + "|" + object.at("path").get<std::string>() + "|" + object.at("entityId").get<std::string>());
        }
        if (actual != expected) {
            fprintf(stderr, "Project fixture %s disagrees with JS validation\n", fixture.at("name").get<std::string>().c_str());
            for (const auto& value : actual) fprintf(stderr, " native: %s\n", value.c_str());
            for (const auto& value : expected) fprintf(stderr, " JS:     %s\n", value.c_str());
            assert(false);
        }
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
static void check_session() {
    std::ifstream stream(FL2D_SESSION_FIXTURES);
    assert(stream.good());
    picojson::value fixture;
    assert(picojson::parse(fixture, stream).empty());
    const auto& root = fixture.get<picojson::object>();
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
        if (parsed(session_text(session)).serialize() != want.at("project").serialize()) {
            fprintf(stderr, "project mismatch at step %zu (%s)\n", i, op.c_str()); assert(false);
        }
        if (parsed(session_text(session, true)).serialize() != want.at("history").serialize()) {
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
    // The legacy snapshot validator omits display-name and reachability checks;
    // session admission must reject both before commands can touch the graph.
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
    for (auto& [key, p] : prepared) { (void)key; fl2d_prepared_destroy(p); }
    fl2d_session_destroy(session);
}

static_assert(sizeof(fl2d_status) == sizeof(int32_t), "ABI status must be 32-bit");

int main() {
    int32_t major = 0, minor = -1;
    assert(fl2d_abi_version(&major, &minor) == FL2D_OK && major == 1 && minor == 3);
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
    check_session();
}
