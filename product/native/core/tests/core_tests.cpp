#include "flamoris2d_core.h"

#ifdef NDEBUG
#undef NDEBUG // Keep the conformance checks active in Release/CTest builds.
#endif
#include <cassert>
#include <cstdint>
#include <cstring>
#include <fstream>
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
        assert(actual == expected);
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

static_assert(sizeof(fl2d_status) == sizeof(int32_t), "ABI status must be 32-bit");

int main() {
    int32_t major = 0, minor = -1;
    assert(fl2d_abi_version(&major, &minor) == FL2D_OK && major == 1 && minor == 2);
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
}
