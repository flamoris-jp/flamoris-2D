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
int main() {
  std::ifstream file(FL2D_MESH_AUTHORING_FIXTURES);
  Value fixtures;
  assert(picojson::parse(fixtures, file).empty());
  for (const auto &row : fixtures.get<Object>().at("cases").get<Array>()) {
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
      fprintf(stderr, "Mesh intent mismatch %s\n%s\nExpected: %s\n",
              test.at("name").get<std::string>().c_str(),
              actual.serialize().c_str(),
              test.count("error") ? test.at("error").serialize().c_str()
                                  : test.at("expected").serialize().c_str());
      assert(false);
    }
    fl2d_session_destroy(session);
  }
  for (const auto &row : fixtures.get<Object>().at("generators").get<Array>()) {
    const auto &test = row.get<Object>();
    std::vector<uint8_t> rgba;
    for (const auto &byte : test.at("rgba").get<Array>())
      rgba.push_back(static_cast<uint8_t>(byte.get<double>()));
    auto request = test.at("input").serialize();
    auto output = read([&](char *b, uint32_t c, uint32_t *r) {
      return fl2d_generate_mesh_json(
          static_cast<uint32_t>(test.at("width").get<double>()),
          static_cast<uint32_t>(test.at("height").get<double>()), rgba.data(),
          static_cast<uint32_t>(rgba.size()),
          reinterpret_cast<const uint8_t *>(request.data()),
          static_cast<uint32_t>(request.size()), b, c, r);
    });
    const auto actual = test.count("error") ? output.get<Object>()
                                                  .at("error")
                                                  .get<Object>()
                                                  .at("details")
                                                  .get<Object>()
                                                  .at("message")
                                            : output.get<Object>().at("value");
    if (!equal(actual,
               test.count("error") ? test.at("error") : test.at("expected"))) {
      fprintf(stderr, "Mesh generator mismatch %s\n%s\nExpected: %s\n",
              test.at("name").get<std::string>().c_str(),
              actual.serialize().c_str(),
              test.count("error") ? test.at("error").serialize().c_str()
                                  : test.at("expected").serialize().c_str());
      assert(false);
    }
  }
  uint32_t required = 99;
  const uint8_t byte = 0;
  assert(fl2d_generate_mesh_json(1, 1, &byte, 1, &byte, 1, nullptr, 0,
                                 &required) == FL2D_INVALID_ARGUMENT &&
         required == 0);
  assert(fl2d_generate_mesh_json(0, 0, &byte, 0, &byte, 1, nullptr, 0,
                                 &required) == FL2D_INVALID_ARGUMENT);
  puts("Native mesh authoring and generation conformance passed.");
}
