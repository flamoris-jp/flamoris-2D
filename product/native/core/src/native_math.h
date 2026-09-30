#pragma once
#include "picojson.h"
#include <array>
#include <cmath>
#include <string>
#include <map>
#include <limits>
#include <vector>

namespace fl2d_math {
using Affine = std::array<double, 6>;
inline Affine multiply(const Affine& a, const Affine& b) {
    return {a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
        a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
        a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]};
}
inline Affine local(const picojson::value& value) {
    const auto& t = value.get<picojson::object>();
    const auto& p = t.at("position").get<picojson::object>();
    const auto& s = t.at("scale").get<picojson::object>();
    const auto& pivot = t.at("pivot").get<picojson::object>();
    auto n = [](const picojson::value& v) { return v.is<double>() ? v.get<double>() : std::numeric_limits<double>::quiet_NaN(); };
    const double rotation = n(t.at("rotation"));
    const double cosine = std::cos(rotation), sine = std::sin(rotation);
    const double a = cosine*n(s.at("x")), b = sine*n(s.at("x"));
    const double c = -sine*n(s.at("y")), d = cosine*n(s.at("y"));
    const double x = n(pivot.at("x")), y = n(pivot.at("y"));
    return {a,b,c,d,n(p.at("x"))+x-a*x-c*y,
        n(p.at("y"))+y-b*x-d*y};
}
inline Affine world(const picojson::value& project, const std::string& node_id,
    const std::map<std::string,picojson::value>& overrides = {}) {
    const auto& nodes = project.get<picojson::object>().at("scene").get<picojson::object>()
        .at("nodes").get<picojson::object>();
    std::vector<const picojson::value*> ancestors;
    const auto* current = &nodes.at(node_id);
    while (current) {
        ancestors.push_back(current);
        const auto& parent = current->get<picojson::object>().at("parentId");
        current = parent.is<std::string>() ? &nodes.at(parent.get<std::string>()) : nullptr;
    }
    auto transform = [&](const picojson::value* node) -> const picojson::value& {
        const auto& object = node->get<picojson::object>();
        const auto id = object.at("id").get<std::string>(); const auto it = overrides.find(id);
        return it == overrides.end() ? object.at("transform") : it->second;
    };
    Affine result = local(transform(ancestors.back()));
    for (size_t i = ancestors.size()-1; i > 0; --i)
        result = multiply(result, local(transform(ancestors[i-1])));
    return result;
}
inline picojson::value json(const Affine& matrix) {
    picojson::array result;
    for (const auto n : matrix) result.emplace_back(std::isfinite(n) ? picojson::value(n) : picojson::value());
    return picojson::value(result);
}
}
