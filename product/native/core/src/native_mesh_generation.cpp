#include "native_mesh_generation.h"
#include "native_authoring.h"
#include "native_locale.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <map>
#include <numeric>
#include <set>
#include <vector>

namespace fl2d_mesh {
using namespace fl2d_authoring;
namespace {
constexpr double epsilon = 1e-7, triangle_epsilon = 2e-4;
struct Point {
  double x, y;
  bool operator==(const Point &p) const { return x == p.x && y == p.y; }
  bool operator<(const Point &p) const {
    return y < p.y || (y == p.y && x < p.x);
  }
};
using Points = std::vector<Point>;
using Triangle = std::array<size_t, 3>;
using Triangles = std::vector<Triangle>;
struct Bounds {
  double minX, minY, maxX, maxY;
};
struct Work {
  size_t steps = 0;
  void advance(size_t n = 1) {
    steps += n;
    if (steps > 50000000)
      error("AutoMesh geometry exceeds the bounded native work budget.");
  }
};
Value json(Point p) {
  return Value(Object{{"x", Value(p.x)}, {"y", Value(p.y)}});
}
Value json(const Points &points) {
  Array result;
  for (auto p : points)
    result.push_back(json(p));
  return Value(result);
}
Value diagnostic(const std::string &code, const std::string &message,
                 const Object &details = {}) {
  return Value(Object{{"code", Value(code)},
                      {"message", Value(message)},
                      {"details", Value(details)}});
}
double clamp(const Value &v, double fallback) {
  return v.is<double>() && std::isfinite(v.get<double>())
             ? std::clamp(v.get<double>(), 0.0, 1.0)
             : fallback;
}
double cross(Point a, Point b, Point c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
double area(const Points &ps) {
  double twice = 0;
  for (size_t i = 0; i < ps.size(); ++i) {
    const auto a = ps[i], b = ps[(i + 1) % ps.size()];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}
Points canonical(Points ps) {
  ps.erase(std::unique(ps.begin(), ps.end()), ps.end());
  if (ps.size() > 1 && ps.front() == ps.back())
    ps.pop_back();
  if (area(ps) < 0)
    std::reverse(ps.begin(), ps.end());
  if (!ps.empty())
    std::rotate(ps.begin(), std::min_element(ps.begin(), ps.end()), ps.end());
  return ps;
}
double distance(Point p, Point a, Point b) {
  const auto length = std::hypot(b.x - a.x, b.y - a.y);
  return length <= epsilon ? std::hypot(p.x - a.x, p.y - a.y)
                           : std::abs(cross(a, b, p)) / length;
}
// Explicit work list preserves recursive Douglas-Peucker traversal without
// exposing the native stack to adversarial long zigzag contours.
Points simplify_open(const Points &ps, double tolerance, Work &work) {
  if (ps.size() <= 2)
    return ps;
  std::vector<bool> keep(ps.size());
  keep.front() = keep.back() = true;
  std::vector<std::pair<size_t, size_t>> pending{{0, ps.size() - 1}};
  while (!pending.empty()) {
    const auto [first, last] = pending.back();
    pending.pop_back();
    size_t farthest = first;
    double d = tolerance;
    for (size_t i = first + 1; i < last; ++i) {
      work.advance();
      const auto next = distance(ps[i], ps[first], ps[last]);
      if (next > d) {
        d = next;
        farthest = i;
      }
    }
    if (farthest != first) {
      keep[farthest] = true;
      pending.emplace_back(farthest, last);
      pending.emplace_back(first, farthest);
    }
  }
  Points result;
  for (size_t i = 0; i < ps.size(); ++i)
    if (keep[i])
      result.push_back(ps[i]);
  return result;
}
Points simplify_closed(const Points &contour, double tolerance, Work &work) {
  auto c = canonical(contour);
  size_t opposite = 1;
  double farthest = -1;
  for (size_t i = 1; i < c.size(); ++i) {
    const double d = std::hypot(c[i].x - c[0].x, c[i].y - c[0].y);
    if (d > farthest) {
      farthest = d;
      opposite = i;
    }
  }
  auto first = simplify_open(
      Points(c.begin(), c.begin() + static_cast<std::ptrdiff_t>(opposite + 1)),
      tolerance, work);
  auto rest =
      Points(c.begin() + static_cast<std::ptrdiff_t>(opposite), c.end());
  rest.push_back(c[0]);
  auto second = simplify_open(rest, tolerance, work);
  first.pop_back();
  second.pop_back();
  first.insert(first.end(), second.begin(), second.end());
  return canonical(first);
}
bool inside(Point p, const Points &polygon) {
  bool in = false;
  for (size_t i = 0, j = polygon.size() - 1; i < polygon.size(); j = i++) {
    const auto a = polygon[i], b = polygon[j];
    if ((a.y > p.y) != (b.y > p.y) &&
        p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
      in = !in;
  }
  return in;
}
double segment_distance(Point p, Point a, Point b) {
  const auto dx = b.x - a.x, dy = b.y - a.y, den = dx * dx + dy * dy;
  const auto t =
      den <= epsilon
          ? 0
          : std::clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / den, 0.0, 1.0);
  return std::hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
bool in_triangle(Point p, Point a, Point b, Point c) {
  return cross(a, b, p) >= -epsilon && cross(b, c, p) >= -epsilon &&
         cross(c, a, p) >= -epsilon;
}
Triangles triangulate(const Points &ps, Work &work) {
  std::vector<size_t> remaining(ps.size());
  std::iota(remaining.begin(), remaining.end(), 0);
  Triangles triangles;
  while (remaining.size() > 3) {
    bool clipped = false;
    for (size_t i = 0; i < remaining.size(); ++i) {
      const auto a = remaining[(i + remaining.size() - 1) % remaining.size()],
                 b = remaining[i], c = remaining[(i + 1) % remaining.size()];
      if (cross(ps[a], ps[b], ps[c]) <= epsilon)
        continue;
      bool contains = false;
      for (auto candidate : remaining) {
        work.advance();
        if (candidate != a && candidate != b && candidate != c &&
            in_triangle(ps[candidate], ps[a], ps[b], ps[c])) {
          contains = true;
          break;
        }
      }
      if (contains)
        continue;
      triangles.push_back({a, b, c});
      remaining.erase(remaining.begin() + static_cast<std::ptrdiff_t>(i));
      clipped = true;
      break;
    }
    if (!clipped)
      return {};
  }
  if (remaining.size() == 3 &&
      cross(ps[remaining[0]], ps[remaining[1]], ps[remaining[2]]) > epsilon)
    triangles.push_back({remaining[0], remaining[1], remaining[2]});
  return triangles;
}

Bounds bounds(const Points &ps) {
  Bounds b{INFINITY, INFINITY, -INFINITY, -INFINITY};
  for (auto p : ps) {
    b.minX = std::min(b.minX, p.x);
    b.minY = std::min(b.minY, p.y);
    b.maxX = std::max(b.maxX, p.x);
    b.maxY = std::max(b.maxY, p.y);
  }
  return b;
}
std::string key(Point p) {
  return std::to_string(static_cast<int64_t>(p.x)) + "," +
         std::to_string(static_cast<int64_t>(p.y));
}
} // namespace
Value generate(uint32_t width, uint32_t height, const uint8_t *rgba,
               const Value &input) {
  if (!width || !height || width > 16384 || height > 16384 ||
      static_cast<uint64_t>(width) * height > 100000000 || !rgba)
    error("AutoMesh requires width × height RGBA image data.");
  const auto kind = text(field(input, "kind"));
  const auto &settings = field(input, "settings");
  const auto threshold = clamp(field(settings, "alphaThreshold"), .1),
             density = clamp(field(settings, "density"), .45),
             corner = clamp(field(settings, "cornerSensitivity"), .65),
             interior = clamp(field(settings, "interiorDensity"), .3);
  const Value normalized(Object{{"alphaThreshold", Value(threshold)},
                                {"density", Value(density)},
                                {"cornerSensitivity", Value(corner)},
                                {"interiorDensity", Value(interior)}});
  double left = number(field(input, "left")), top = number(field(input, "top"));
  if (!std::isfinite(left) || !std::isfinite(top))
    error("Artwork bounds must be finite.");
  if (kind == "grid") {
    int minX = static_cast<int>(width), minY = static_cast<int>(height),
        maxX = -1, maxY = -1;
    for (uint32_t y = 0; y < height; ++y)
      for (uint32_t x = 0; x < width; ++x)
        if (rgba[(static_cast<size_t>(y) * width + x) * 4 + 3] > 0) {
          minX = std::min(minX, static_cast<int>(x));
          minY = std::min(minY, static_cast<int>(y));
          maxX = std::max(maxX, static_cast<int>(x));
          maxY = std::max(maxY, static_cast<int>(y));
        }
    if (maxX < minX || maxY < minY)
      error("Visible pixels were not found in the PNG.");
    auto size = [](const Value &v) {
      return std::isfinite(number(v, 6))
                 ? static_cast<int>(
                       std::clamp(std::trunc(number(v, 6)), 1.0, 32.0))
                 : 6;
    };
    const int columns = size(field(input, "columns")),
              rows = size(field(input, "rows"));
    Array positions, uvs, indices;
    for (int row = 0; row <= rows; ++row)
      for (int col = 0; col <= columns; ++col) {
        double x = minX + static_cast<double>(maxX + 1 - minX) * col / columns,
               y = minY + static_cast<double>(maxY + 1 - minY) * row / rows;
        positions.emplace_back(static_cast<double>(static_cast<float>(x)) +
                               left);
        positions.emplace_back(static_cast<double>(static_cast<float>(y)) +
                               top);
        uvs.emplace_back(static_cast<double>(static_cast<float>(x / width)));
        uvs.emplace_back(static_cast<double>(static_cast<float>(y / height)));
      }
    for (int row = 0; row < rows; ++row)
      for (int col = 0; col < columns; ++col) {
        const int a = row * (columns + 1) + col, b = a + 1, c = a + columns + 1,
                  d = c + 1;
        for (int i : {a, b, d, a, d, c})
          indices.emplace_back(static_cast<double>(i));
      }
    return Value(
        Object{{"candidate", Value(Object{{"positions", Value(positions)},
                                          {"uvs", Value(uvs)},
                                          {"indices", Value(indices)}})},
               {"diagnostics", Value(Array{})}});
  }
  if (kind != "contour")
    error("Unknown mesh generator.");
  auto failed = [&](const Value &d) {
    return Value(Object{{"settings", normalized},
                        {"candidate", Value()},
                        {"diagnostics", Value(Array{d})}});
  };
  const size_t pixels = static_cast<size_t>(width) * height;
  if (pixels > 16777216)
    error("AutoMesh raster exceeds the bounded native work budget.");
  Work work;
  std::vector<uint8_t> mask(pixels), seen(pixels);
  size_t visible = 0;
  const int alpha =
      std::max(1, static_cast<int>(std::floor(threshold * 255 + .5)));
  for (size_t i = 0; i < pixels; ++i) {
    mask[i] = rgba[i * 4 + 3] >= alpha;
    visible += mask[i];
  }
  if (!visible)
    return failed(diagnostic("AUTOMESH_NO_VISIBLE_ALPHA",
                             "No pixels meet the alpha threshold."));
  size_t components = 0;
  std::vector<uint32_t> queue;
  for (size_t start = 0; start < pixels; ++start) {
    if (!mask[start] || seen[start])
      continue;
    ++components;
    queue.clear();
    queue.push_back(static_cast<uint32_t>(start));
    seen[start] = 1;
    for (size_t cursor = 0; cursor < queue.size(); ++cursor) {
      work.advance();
      const size_t i = queue[cursor], x = i % width, y = i / width;
      auto visit = [&](size_t n) {
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          queue.push_back(static_cast<uint32_t>(n));
        }
      };
      if (x > 0)
        visit(i - 1);
      if (x + 1 < width)
        visit(i + 1);
      if (y > 0)
        visit(i - width);
      if (y + 1 < height)
        visit(i + width);
    }
  }
  if (components > 1)
    return failed(diagnostic(
        "AUTOMESH_MULTIPLE_REGIONS_UNSUPPORTED",
        "The initial contour generator requires one connected visible region.",
        {{"componentCount", Value(static_cast<double>(components))}}));
  // Release flood-fill storage before constructing the contour graph.
  std::vector<uint8_t>().swap(seen);
  std::vector<uint32_t>().swap(queue);
  std::map<std::string, std::vector<Point>> outgoing;
  std::map<std::string, std::pair<Point, Point>> unused;
  size_t edge_count = 0;
  auto edge = [&](Point a, Point b) {
    if (++edge_count > 262144)
      error("AutoMesh contour exceeds the bounded native work budget.");
    outgoing[key(a)].push_back(b);
    unused.emplace(key(a) + ">" + key(b), std::make_pair(a, b));
  };
  auto opaque = [&](int x, int y) {
    return x >= 0 && y >= 0 && x < static_cast<int>(width) &&
           y < static_cast<int>(height) &&
           mask[static_cast<size_t>(y) * width + static_cast<size_t>(x)];
  };
  for (int y = 0; y < static_cast<int>(height); ++y)
    for (int x = 0; x < static_cast<int>(width); ++x)
      if (opaque(x, y)) {
        double dx = x, dy = y;
        if (!opaque(x, y - 1))
          edge({dx, dy}, {dx + 1, dy});
        if (!opaque(x + 1, y))
          edge({dx + 1, dy}, {dx + 1, dy + 1});
        if (!opaque(x, y + 1))
          edge({dx + 1, dy + 1}, {dx, dy + 1});
        if (!opaque(x - 1, y))
          edge({dx, dy + 1}, {dx, dy});
      }
  std::vector<uint8_t>().swap(mask);
  for (auto &entry : outgoing)
    std::sort(entry.second.begin(), entry.second.end());
  std::vector<Points> loops;
  while (!unused.empty()) {
    auto start = unused.begin()->second.first, current = start;
    Points loop{start};
    for (size_t guard = 0; guard <= edge_count; ++guard) {
      bool found = false;
      for (auto next : outgoing[key(current)]) {
        auto it = unused.find(key(current) + ">" + key(next));
        if (it == unused.end())
          continue;
        unused.erase(it);
        current = next;
        found = true;
        break;
      }
      if (!found || current == start)
        break;
      loop.push_back(current);
    }
    if (loop.size() >= 3 && current == start)
      loops.push_back(canonical(loop));
  }
  if (loops.size() != 1)
    return failed(diagnostic(
        "AUTOMESH_HOLES_UNSUPPORTED",
        "The initial contour generator does not support holes.",
        {{"contourCount", Value(static_cast<double>(loops.size()))}}));
  const auto contour = loops[0];
  if (visible < 4 || std::abs(area(contour)) < 4)
    return failed(
        diagnostic("AUTOMESH_CONTOUR_TOO_SMALL",
                   "The visible contour is too small to triangulate.",
                   {{"visibleCount", Value(static_cast<double>(visible))}}));

  const auto raw = bounds(contour);
  const double shortest = std::max(
                   1.0, std::min(raw.maxX - raw.minX, raw.maxY - raw.minY)),
               tolerance = shortest / (10 + density * 24) * (1.5 - corner);
  auto simplified = simplify_closed(contour, tolerance, work);
  if (simplified.size() < 3 || std::abs(area(simplified)) <= epsilon)
    return failed(
        diagnostic("AUTOMESH_DEGENERATE_CONTOUR",
                   "Contour simplification produced a degenerate polygon."));
  const double maximum = shortest / (3 + density * 9),
               minimum_turn = (55 - corner * 40) * std::acos(-1.0) / 180;
  Points vertices;
  Array kinds;
  for (size_t i = 0; i < simplified.size(); ++i) {
    auto a = simplified[i], b = simplified[(i + 1) % simplified.size()],
         previous = simplified[(i + simplified.size() - 1) % simplified.size()];
    double turn = std::abs(std::atan2(b.y - a.y, b.x - a.x) -
                           std::atan2(a.y - previous.y, a.x - previous.x));
    if (turn > std::acos(-1.0))
      turn = std::acos(-1.0) * 2 - turn;
    vertices.push_back(a);
    kinds.emplace_back(turn >= minimum_turn ? "corner" : "boundary");
    const auto count = static_cast<size_t>(
        std::ceil(std::hypot(b.x - a.x, b.y - a.y) / maximum));
    for (size_t step = 1; step < count; ++step) {
      vertices.push_back({a.x + (b.x - a.x) * static_cast<double>(step) /
                                    static_cast<double>(count),
                          a.y + (b.y - a.y) * static_cast<double>(step) /
                                    static_cast<double>(count)});
      kinds.emplace_back("boundary");
    }
    if (vertices.size() > 16384)
      error("AutoMesh boundary exceeds the bounded native work budget.");
  }
  const size_t boundary_count = vertices.size();
  auto triangles = triangulate(vertices, work);
  Points supports;
  if (interior > 0) {
    const double spacing = maximum * (2.2 - interior * 1.2),
                 inset = std::max(.5, spacing * .32);
    for (double y = raw.minY + spacing / 2; y < raw.maxY; y += spacing)
      for (double x = raw.minX + spacing / 2; x < raw.maxX; x += spacing) {
        Point point{x, y};
        work.advance(vertices.size());
        if (!inside(point, vertices))
          continue;
        double d = INFINITY;
        for (size_t i = 0; i < vertices.size(); ++i)
          d = std::min(d,
                       segment_distance(point, vertices[i],
                                        vertices[(i + 1) % vertices.size()]));
        if (d >= inset) {
          supports.push_back(point);
          if (supports.size() > 32768)
            error("AutoMesh interior exceeds the bounded native work budget.");
        }
      }
  }
  for (auto point : supports) {
    for (size_t i = 0; i < triangles.size(); ++i) {
      work.advance();
      const auto t = triangles[i];
      if (!in_triangle(point, vertices[t[0]], vertices[t[1]], vertices[t[2]]))
        continue;
      bool on_edge = false;
      for (size_t e = 0; e < 3; ++e)
        if (std::abs(cross(vertices[t[e]], vertices[t[(e + 1) % 3]], point)) <=
            triangle_epsilon)
          on_edge = true;
      if (!on_edge) {
        size_t n = vertices.size();
        vertices.push_back(point);
        triangles.erase(triangles.begin() + static_cast<std::ptrdiff_t>(i));
        triangles.insert(triangles.begin() + static_cast<std::ptrdiff_t>(i),
                         {{t[0], t[1], n}, {t[1], t[2], n}, {t[2], t[0], n}});
        kinds.emplace_back("interior");
      }
      break;
    }
  }
  if (triangles.empty())
    return failed(
        diagnostic("AUTOMESH_TRIANGULATION_FAILURE",
                   "The candidate contour could not be triangulated."));
  std::set<Point> unique(vertices.begin(), vertices.end());
  if (unique.size() != vertices.size())
    return failed(
        diagnostic("AUTOMESH_DUPLICATE_CANDIDATE_VERTEX",
                   "AutoMesh produced duplicate candidate vertices."));
  for (const auto t : triangles) {
    const auto size =
        std::abs(cross(vertices[t[0]], vertices[t[1]], vertices[t[2]]));
    if (size <= triangle_epsilon) {
      Array refs;
      for (auto i : t)
        refs.emplace_back(static_cast<double>(i));
      return failed(diagnostic(
          size <= epsilon ? "AUTOMESH_ZERO_AREA_TRIANGLE"
                          : "AUTOMESH_NEAR_DEGENERATE_TRIANGLE",
          size <= epsilon ? "AutoMesh produced a zero-area triangle."
                          : "AutoMesh produced a near-degenerate triangle.",
          {{"triangle", Value(refs)}}));
    }
  }
  Array positions, uvs, indices, temp;
  Points projected;
  for (auto p : contour)
    projected.push_back({left + p.x, top + p.y});
  for (size_t i = 0; i < vertices.size(); ++i) {
    auto p = vertices[i];
    positions.emplace_back(left + p.x);
    positions.emplace_back(top + p.y);
    uvs.emplace_back(p.x / width);
    uvs.emplace_back(p.y / height);
    std::ostringstream s;
    s << "candidate_" << std::setfill('0') << std::setw(4) << i + 1;
    temp.emplace_back(s.str());
  }
  for (auto t : triangles)
    for (auto i : t)
      indices.emplace_back(static_cast<double>(i));
  return Value(Object{
      {"settings", normalized},
      {"diagnostics", Value(Array{})},
      {"candidate",
       Value(Object{
           {"contour", json(projected)},
           {"positions", Value(positions)},
           {"uvs", Value(uvs)},
           {"indices", Value(indices)},
           {"vertexKinds", Value(kinds)},
           {"temporaryVertexIds", Value(temp)},
           {"boundaryVertexCount", Value(static_cast<double>(boundary_count))},
           {"interiorVertexCount",
            Value(static_cast<double>(vertices.size() - boundary_count))}})}});
}
} // namespace fl2d_mesh

extern "C" FL2D_API fl2d_status FL2D_CALL fl2d_generate_mesh_json(
    uint32_t width, uint32_t height, const uint8_t *rgba, uint32_t byte_length,
    const uint8_t *bytes, uint32_t length, char *buffer, uint32_t capacity,
    uint32_t *required) {
  if (!required)
    return FL2D_INVALID_ARGUMENT;
  *required = 0;
  if (!rgba || !bytes || !length || !width || !height || width > 16384 ||
      height > 16384 || static_cast<uint64_t>(width) * height > 100000000 ||
      static_cast<uint64_t>(width) * height * 4 != byte_length)
    return FL2D_INVALID_ARGUMENT;
  if (length > FL2D_SNAPSHOT_MAX_BYTES)
    return FL2D_INPUT_TOO_LARGE;
  try {
    const std::string source(reinterpret_cast<const char *>(bytes), length);
    try {
      (void)fl2d_locale::utf16(source);
    } catch (const std::bad_alloc &) {
      throw;
    } catch (...) {
      return FL2D_INVALID_UTF8;
    }
    picojson::value input;
    std::string issue;
    auto end = picojson::parse(input, source.begin(), source.end(), &issue);
    if (!issue.empty() || end != source.end())
      return FL2D_MALFORMED_JSON;
    if (!input.is<picojson::object>())
      return FL2D_INVALID_ARGUMENT;
    picojson::value result;
    try {
      result = picojson::value(picojson::object{
          {"value", fl2d_mesh::generate(width, height, rgba, input)}});
    } catch (const fl2d_queries::Error &e) {
      result = picojson::value(picojson::object{
          {"error",
           picojson::value(picojson::object{
               {"code", picojson::value("mesh.generation_failed")},
               {"details", picojson::value(picojson::object{
                               {"message", picojson::value(e.message)}})}})}});
    }
    const auto output = result.serialize();
    if (output.size() >= FL2D_DOCUMENT_MAX_BYTES)
      return FL2D_INPUT_TOO_LARGE;
    *required = static_cast<uint32_t>(output.size() + 1);
    if (!buffer || capacity < *required)
      return FL2D_BUFFER_TOO_SMALL;
    std::memcpy(buffer, output.c_str(), *required);
    return FL2D_OK;
  } catch (const std::bad_alloc &) {
    return FL2D_OUT_OF_MEMORY;
  } catch (...) {
    return FL2D_INTERNAL_ERROR;
  }
}
