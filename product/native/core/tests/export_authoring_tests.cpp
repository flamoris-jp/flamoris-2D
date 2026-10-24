#ifdef NDEBUG
#undef NDEBUG
#endif
#include "flamoris2d_core.h"
#include "picojson.h"
#include <cassert>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <vector>
using Value = picojson::value;
using Object = picojson::object;
using Array = picojson::array;
static bool equal(const Value &a, const Value &b) {
  if (a.is<double>() && b.is<double>())
    return std::abs(a.get<double>() - b.get<double>()) <=
           1e-12 * std::max(1.0, std::abs(b.get<double>()));
  if (a.is<Object>() && b.is<Object>()) {
    if (a.get<Object>().size() != b.get<Object>().size())
      return false;
    for (const auto &item : b.get<Object>()) {
      auto found = a.get<Object>().find(item.first);
      if (found == a.get<Object>().end() || !equal(found->second, item.second))
        return false;
    }
    return true;
  }
  if (a.is<Array>() && b.is<Array>()) {
    if (a.get<Array>().size() != b.get<Array>().size())
      return false;
    for (size_t i = 0; i < a.get<Array>().size(); ++i)
      if (!equal(a.get<Array>()[i], b.get<Array>()[i]))
        return false;
    return true;
  }
  return a == b;
}
template <class F> static Value read(F call) {
  uint32_t required = 0;
  assert(call(nullptr, 0, &required) == FL2D_BUFFER_TOO_SMALL);
  std::vector<char> out(required);
  assert(call(out.data(), required, &required) == FL2D_OK);
  Value value;
  assert(picojson::parse(value, std::string(out.data(), required - 1)).empty());
  return value;
}
static void bitrate_tests(const Array &fixtures) {
  const auto project = fixtures[0].get<Object>().at("project").serialize();
  fl2d_session *session = nullptr;
  assert(fl2d_session_create(reinterpret_cast<const uint8_t *>(project.data()),
                             static_cast<uint32_t>(project.size()), &session) == FL2D_OK);
  fl2d_session_state before{}, after{};
  assert(fl2d_session_state_get(session, &before) == FL2D_OK);
  auto query = [&](const std::string &name, const Object &input) {
    auto request = Value(Object{{"name", Value(name)}, {"input", Value(input)}}).serialize();
    return read([&](char *b, uint32_t c, uint32_t *r) {
      return fl2d_session_query_json(session, reinterpret_cast<const uint8_t *>(request.data()),
                                     static_cast<uint32_t>(request.size()), b, c, r);
    });
  };
  auto encoder = fixtures[16].get<Object>().at("input").get<Object>();
  auto plan = fixtures[1].get<Object>().at("input").get<Object>();
  plan["video"] = Value(true);
  // Bitrate changes the encode request, never rational timing or PNG content.
  const auto baseline_plan = query("native.export_plan", plan);
  assert(!baseline_plan.get<Object>().count("error"));
  for (double bit_rate : {1000000.0, 10000000.0, 20000000.0, 12345678.0, 200000000.0}) {
    encoder["videoBitRate"] = Value(bit_rate);
    auto result = query("native.encoder", encoder).get<Object>().at("value");
    auto expected = fixtures[16].get<Object>().at("expected");
    auto &args = expected.get<Object>().at("args").get<Array>();
    for (size_t i = 0; i + 1 < args.size(); ++i)
      if (args[i] == Value("-b:v")) args[i + 1] = Value(std::to_string(static_cast<int>(bit_rate)));
    expected.get<Object>().at("profile").get<Object>()["videoBitRate"] = Value(bit_rate);
    assert(equal(result, expected));
    plan["videoBitRate"] = Value(bit_rate);
    assert(equal(query("native.export_plan", plan), baseline_plan));
  }
  for (const auto &invalid : Array{Value(), Value("20M"), Value(0.0), Value(-1.0),
                                  Value(999999.0), Value(200000001.0), Value(1000000.5), Value(1e20)}) {
    encoder["videoBitRate"] = invalid;
    plan["videoBitRate"] = invalid;
    plan["video"] = Value(true);
    for (const auto &result : {query("native.encoder", encoder), query("native.export_plan", plan)}) {
      const auto &error = result.get<Object>().at("error").get<Object>();
      assert(error.at("name") == Value("RangeError"));
      assert(error.at("message") == Value("Video bitrate must be an integer from 1000000 to 200000000 bits/sec."));
    }
    plan["video"] = Value(false);
    assert(equal(query("native.export_plan", plan), baseline_plan));
  }
  assert(fl2d_session_state_get(session, &after) == FL2D_OK);
  assert(before.current_revision == after.current_revision);
  assert(before.undo_depth == after.undo_depth && before.redo_depth == after.redo_depth);
  fl2d_session_destroy(session);
}
int main() {
  std::ifstream file(FL2D_EXPORT_AUTHORING_FIXTURES);
  Value fixtures;
  assert(picojson::parse(fixtures, file).empty());
  bitrate_tests(fixtures.get<Array>());
  for (const auto &row : fixtures.get<Array>()) {
    const auto &test = row.get<Object>();
    const auto project = test.at("project").serialize();
    fl2d_session *session = nullptr;
    assert(fl2d_session_create(
               reinterpret_cast<const uint8_t *>(project.data()),
               static_cast<uint32_t>(project.size()), &session) == FL2D_OK);
    const auto request =
        Value(Object{{"name", test.at("query")}, {"input", test.at("input")}})
            .serialize();
    auto output = read([&](char *b, uint32_t c, uint32_t *r) {
      return fl2d_session_query_json(
          session, reinterpret_cast<const uint8_t *>(request.data()),
          static_cast<uint32_t>(request.size()), b, c, r);
    });
    const auto actual =
        test.count("error")
            ? output.get<Object>().at("error").get<Object>().at("message")
            : output.get<Object>().at("value");
    if (!equal(actual,
               test.count("error") ? test.at("error") : test.at("expected"))) {
      fprintf(stderr, "Export authoring mismatch %s\n",
              test.at("name").get<std::string>().c_str());
      assert(false);
    }
    if (test.count("after") &&
        actual.get<Object>().at("commands").get<Array>().size() > 0) {
      const auto commands = actual.get<Object>().at("commands").serialize();
      fl2d_prepared *prepared = nullptr;
      const auto status = fl2d_session_prepare(
          session, reinterpret_cast<const uint8_t *>(commands.data()),
          static_cast<uint32_t>(commands.size()),
          actual.get<Object>().at("label").get<std::string>().c_str(),
          &prepared);
      if (status != FL2D_OK) {
        fprintf(stderr, "Export prepare failed %s: %d\n",
                test.at("name").get<std::string>().c_str(), status);
        assert(false);
      }
      assert(fl2d_prepared_commit(prepared) == FL2D_OK);
      fl2d_prepared_destroy(prepared);
      auto after = read([&](char *b, uint32_t c, uint32_t *r) {
        return fl2d_session_project_json(session, b, c, r);
      });
      if (!equal(after, test.at("after"))) {
        fprintf(stderr, "Export committed project differs %s\n",
                test.at("name").get<std::string>().c_str());
        assert(false);
      }
      assert(fl2d_session_prepare_undo(session, &prepared) == FL2D_OK);
      assert(fl2d_prepared_commit(prepared) == FL2D_OK);
      fl2d_prepared_destroy(prepared);
      auto restored = read([&](char *b, uint32_t c, uint32_t *r) {
        return fl2d_session_project_json(session, b, c, r);
      });
      assert(equal(restored, test.at("project")));
      assert(fl2d_session_prepare_redo(session, &prepared) == FL2D_OK);
      assert(fl2d_prepared_commit(prepared) == FL2D_OK);
      fl2d_prepared_destroy(prepared);
      assert(equal(read([&](char *b, uint32_t c, uint32_t *r) {
                     return fl2d_session_project_json(session, b, c, r);
                   }),
                   test.at("after")));
    }
    fl2d_session_destroy(session);
  }
  puts("Native Export authoring conformance passed.");
}
