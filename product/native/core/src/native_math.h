#pragma once
#include "picojson.h"
#include <array>
#include <cmath>
#include <string>
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
    const double rotation = t.at("rotation").get<double>();
    const double cosine = std::cos(rotation), sine = std::sin(rotation);
    const double a = cosine*s.at("x").get<double>(), b = sine*s.at("x").get<double>();
    const double c = -sine*s.at("y").get<double>(), d = cosine*s.at("y").get<double>();
    const double x = pivot.at("x").get<double>(), y = pivot.at("y").get<double>();
    return {a,b,c,d,p.at("x").get<double>()+x-a*x-c*y,
        p.at("y").get<double>()+y-b*x-d*y};
}
inline Affine world(const picojson::value& project, const std::string& node_id) {
    const auto& nodes = project.get<picojson::object>().at("scene").get<picojson::object>()
        .at("nodes").get<picojson::object>();
    std::vector<const picojson::value*> ancestors;
    const auto* current = &nodes.at(node_id);
    while (current) {
        ancestors.push_back(current);
        const auto& parent = current->get<picojson::object>().at("parentId");
        current = parent.is<std::string>() ? &nodes.at(parent.get<std::string>()) : nullptr;
    }
    Affine result = local(ancestors.back()->get<picojson::object>().at("transform"));
    for (size_t i = ancestors.size()-1; i > 0; --i)
        result = multiply(result, local(ancestors[i-1]->get<picojson::object>().at("transform")));
    return result;
}
inline picojson::value json(const Affine& matrix) {
    picojson::array result;
    for (const auto n : matrix) result.emplace_back(std::isfinite(n) ? picojson::value(n) : picojson::value());
    return picojson::value(result);
}
}
