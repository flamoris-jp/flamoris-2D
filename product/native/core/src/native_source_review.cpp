#include "native_source_review.h"
#include "native_commands.h"
#include "native_validation.h"
#include <algorithm>
#include <functional>
#include <iomanip>
#include <set>
#include <sstream>

namespace fl2d_sources {
using namespace fl2d_commands;
static std::string text(const Value &v) {
  return v.is<std::string>() ? v.get<std::string>() : "";
}
static bool yes(const Value &v) { return v == Value(true); }
static Value cmd_error() {
  throw Failure{FL2D_COMMAND_INVALID, "source.review_invalid"};
}
static const Object &nodes(const Value &p) {
  return field(field(p, "scene"), "nodes").get<Object>();
}
static const Value &node(const Value &p, const Value &id) {
  return field(field(field(p, "scene"), "nodes"), text(id));
}
static bool changed(const Value &current, const Value &imported) {
  for (const auto key :
       {"displayName", "visible", "opacity", "blendMode", "bounds"})
    if (field(current, key) != field(imported, key))
      return true;
  if (field(current, "kind") != Value("part") &&
      field(imported, "kind") != Value("part"))
    return false;
  const auto &a = field(field(current, "sourceRef"), "rasterFingerprint"),
             &b = field(field(imported, "sourceRef"), "rasterFingerprint");
  return text(a).empty() || text(b).empty() || a != b;
}
static Array analyze(const Value &current, const Value &imported) {
  std::map<std::string, Array> a, b;
  std::vector<std::string> keys;
  auto index = [&](const Value &p, std::map<std::string, Array> &values) {
    for (const auto &entry : nodes(p)) {
      const auto key =
          text(field(field(entry.second, "sourceRef"), "sourceKey"));
      if (key.empty())
        continue;
      if (!a.count(key) && !b.count(key))
        keys.push_back(key);
      values[key].push_back(entry.second);
    }
  };
  index(current, a);
  index(imported, b);
  Array matched, added, missing, ambiguous;
  auto row = [&](const char *status, const Value &old_id, const Value &new_id,
                 const Array &candidates, const char *source,
                 const std::string &explanation, const char *action) {
    return Value(Object{{"status", Value(status)},
                        {"currentNodeId", old_id},
                        {"importedNodeId", new_id},
                        {"candidateImportedNodeIds", Value(candidates)},
                        {"matchSource", Value(source)},
                        {"explanation", Value(explanation)},
                        {"action", Value(action)}});
  };
  for (const auto &key : keys) {
    auto &old = a[key];
    auto &next = b[key];
    const bool duplicate = old.size() > 1 || next.size() > 1;
    auto dependent = [](const Array &entries) {
      return std::any_of(entries.begin(), entries.end(), [](const Value &n) {
        return yes(field(field(n, "sourceRef"), "orderDependent"));
      });
    };
    const bool order = dependent(old) || dependent(next);
    if (duplicate || order) {
      Array ids;
      for (const auto &n : next)
        ids.push_back(field(n, "id"));
      const auto explanation =
          order ? "Fallback source identity; order-dependent; manual "
                  "confirmation required"
                : "Duplicate source identity; manual confirmation required";
      if (old.empty())
        ambiguous.push_back(row("ambiguous", Value(), Value(), ids, "uncertain",
                                explanation, "unresolved"));
      for (const auto &n : old)
        ambiguous.push_back(row("ambiguous", field(n, "id"), Value(), ids,
                                "uncertain", explanation, "unresolved"));
    } else if (old.size() == 1 && next.size() == 1) {
      const bool change = changed(old[0], next[0]);
      matched.push_back(row(
          change ? "changed" : "matched", field(old[0], "id"),
          field(next[0], "id"), Array{field(next[0], "id")}, "auto",
          field(field(next[0], "sourceRef"), "identityKind") == Value("native")
              ? "Native PSD layer ID: exact match"
              : "Fallback source identity",
          change ? "update" : "keep"));
    } else if (next.size() == 1)
      added.push_back(row("added", Value(), field(next[0], "id"),
                          Array{field(next[0], "id")}, "new", "New PSD layer",
                          "add"));
    else if (old.size() == 1)
      missing.push_back(row("missing", field(old[0], "id"), Value(), Array{},
                            "missing", "No corresponding PSD layer was found",
                            "keep"));
  }
  Array rows;
  for (const auto *group : {&matched, &added, &missing, &ambiguous})
    for (const auto &value : *group) {
      auto r = value;
      auto &o = r.get<Object>();
      o["id"] = Value("reimport-row-" + std::to_string(rows.size() + 1));
      o["manual"] = Value(false);
      const auto baseline = r;
      o["auto"] = baseline;
      rows.push_back(r);
    }
  return rows;
}
static bool compatible(const Value &current, const Value &imported,
                       const Value &row, const Value &id) {
  const auto &n = node(imported, id);
  if (!n.is<Object>() || id == field(field(imported, "scene"), "rootId"))
    return false;
  const auto &old_id = field(row, "currentNodeId");
  return old_id.is<picojson::null>() ||
         (node(current, old_id).is<Object>() &&
          field(node(current, old_id), "kind") == field(n, "kind"));
}
static bool valid_rows(const Value &current, const Value &imported,
                       const Array &rows) {
  std::set<std::string> claims;
  for (const auto &row : rows) {
    const auto action = text(field(row, "action"));
    if (action == "unresolved")
      return false;
    if (action != "update" && action != "keep" && action != "add" &&
        action != "remove" && action != "ignore")
      return false;
    const auto &id = field(row, "importedNodeId");
    if (id.is<picojson::null>() ||
        (action != "update" && action != "keep" && action != "add"))
      continue;
    if (!node(imported, id).is<Object>() ||
        id == field(field(imported, "scene"), "rootId") ||
        !claims.insert(text(id)).second)
      return false;
    if (action != "add" && !compatible(current, imported, row, id))
      return false;
  }
  return true;
}
static void change(const Value &current, const Value &imported, Array &rows,
                   const Value &input) {
  const auto id = field(input, "rowId");
  auto found = std::find_if(rows.begin(), rows.end(), [&](const Value &r) {
    return field(r, "id") == id;
  });
  if (found == rows.end())
    cmd_error();
  auto &r = *found;
  auto &o = r.get<Object>();
  const auto action = text(field(input, "action"));
  if (action == "auto") {
    const auto baseline = field(r, "auto");
    o = baseline.get<Object>();
    o["auto"] = baseline;
  } else {
    o["manual"] = Value(true);
    if (action == "match") {
      const auto selected = field(input, "importedNodeId");
      if (!compatible(current, imported, r, selected))
        cmd_error();
      o["importedNodeId"] = selected;
      o["action"] = Value(
          field(r, "currentNodeId").is<picojson::null>() ? "add" : "update");
      o["matchSource"] = Value("manual");
    } else if (action == "add") {
      if (field(r, "importedNodeId").is<picojson::null>() &&
          field(r, "candidateImportedNodeIds").get<Array>().size() == 1)
        o["importedNodeId"] =
            field(r, "candidateImportedNodeIds").get<Array>()[0];
      if (field(r, "importedNodeId").is<picojson::null>())
        cmd_error();
      o["action"] = Value("add");
      o["matchSource"] = Value("manual");
    } else if (action == "keep" || action == "remove") {
      if (field(r, "currentNodeId").is<picojson::null>())
        cmd_error();
      o["action"] = Value(action);
      o["importedNodeId"] = Value();
      o["matchSource"] = Value("manual");
    } else if (action == "ignore")
      o["action"] = Value("ignore");
    else
      cmd_error();
  }
  // Other unresolved rows may remain during a manual review. Only duplicate
  // assignments and incompatible kinds reject an individual selection.
  auto resolved = rows;
  for (auto &entry : resolved)
    if (field(entry, "action") == Value("unresolved"))
      entry.get<Object>()["action"] = Value("ignore");
  if (!valid_rows(current, imported, resolved))
    cmd_error();
}
static Value projection(const Value &current, const Value &imported,
                        const Array &rows) {
  Object summary{{"update", Value(0.0)},
                 {"add", Value(0.0)},
                 {"keep", Value(0.0)},
                 {"remove", Value(0.0)},
                 {"unresolved", Value(0.0)}};
  Array display;
  for (const auto &row : rows) {
    const auto action = text(field(row, "action"));
    if (summary.count(action))
      summary[action] = Value(summary[action].get<double>() + 1);
    else if (action == "ignore")
      summary["keep"] = Value(summary["keep"].get<double>() + 1);
    if (action == "add" && !field(row, "currentNodeId").is<picojson::null>())
      summary["keep"] = Value(summary["keep"].get<double>() + 1);
    auto r = row;
    Array choices;
    for (const auto &entry : nodes(imported))
      if (compatible(current, imported, row, field(entry.second, "id")))
        choices.emplace_back(
            Object{{"id", field(entry.second, "id")},
                   {"displayName", field(entry.second, "displayName")}});
    auto name =
        field(node(current, field(row, "currentNodeId")), "displayName");
    if (text(name).empty())
      name = field(node(imported, field(row, "importedNodeId")), "displayName");
    if (text(name).empty())
      name = Value("未対応レイヤー");
    r.get<Object>()["displayName"] = name;
    r.get<Object>()["choices"] = Value(choices);
    display.push_back(r);
  }
  return Value(
      Object{{"rows", Value(display)},
             {"summary", Value(summary)},
             {"canApply", Value(valid_rows(current, imported, rows))}});
}
static Value build(const Value &current, const Value &imported,
                   const Array &rows) {
  if (!valid_rows(current, imported, rows))
    cmd_error();
  auto next = current;
  auto &ns =
      next.get<Object>().at("scene").get<Object>().at("nodes").get<Object>();
  const auto root = field(field(next, "scene"), "rootId");
  Object assignments{{text(field(field(imported, "scene"), "rootId")), root}};
  for (const auto &row : rows)
    if (!field(row, "importedNodeId").is<picojson::null>() &&
        !field(row, "currentNodeId").is<picojson::null>() &&
        (field(row, "action") == Value("update") ||
         field(row, "action") == Value("keep")))
      assignments[text(field(row, "importedNodeId"))] =
          field(row, "currentNodeId");
  std::function<void(const std::string &)> remove = [&](const std::string &id) {
    auto n = ns.find(id);
    if (n == ns.end() || Value(id) == root)
      return;
    const auto children = field(n->second, "children").get<Array>();
    for (const auto &child : children)
      remove(text(child));
    const auto parent = text(field(n->second, "parentId"));
    if (ns.count(parent)) {
      auto &siblings = ns[parent].get<Object>().at("children").get<Array>();
      siblings.erase(std::remove(siblings.begin(), siblings.end(), Value(id)),
                     siblings.end());
    }
    ns.erase(id);
  };
  for (const auto &row : rows)
    if (field(row, "action") == Value("remove"))
      remove(text(field(row, "currentNodeId")));
  Value *source = nullptr;
  const Value *imported_source = nullptr;
  for (auto &item : next.get<Object>().at("sourceAssets").get<Array>())
    if (field(item, "kind") == Value("psd")) {
      source = &item;
      break;
    }
  for (const auto &item : field(imported, "sourceAssets").get<Array>())
    if (field(item, "kind") == Value("psd")) {
      imported_source = &item;
      break;
    }
  if (source && imported_source) {
    const auto id = field(*source, "id");
    *source = *imported_source;
    source->get<Object>()["id"] = id;
  }
  for (const auto &row : rows)
    if (field(row, "action") == Value("update")) {
      const auto old = text(field(row, "currentNodeId"));
      const auto &n = node(imported, field(row, "importedNodeId"));
      if (!ns.count(old) || !n.is<Object>())
        continue;
      auto &destination = ns[old].get<Object>();
      for (const auto key : {"visible", "opacity", "blendMode", "sourceRef"})
        destination[key] = field(n, key);
      if (source && destination["sourceRef"].is<Object>())
        destination["sourceRef"].get<Object>()["sourceAssetId"] =
            field(*source, "id");
      if (n.get<Object>().count("bounds"))
        destination["bounds"] = field(n, "bounds");
      else
        destination.erase("bounds");
    }
  Array additions;
  for (const auto &row : rows)
    if (field(row, "action") == Value("add") &&
        !field(row, "importedNodeId").is<picojson::null>())
      additions.push_back(row);
  auto depth = [&](Value id) {
    size_t d = 0;
    while (!field(node(imported, id), "parentId").is<picojson::null>()) {
      if (++d > nodes(imported).size())
        cmd_error();
      id = field(node(imported, id), "parentId");
    }
    return d;
  };
  std::stable_sort(additions.begin(), additions.end(),
                   [&](const Value &a, const Value &b) {
                     return depth(field(a, "importedNodeId")) <
                            depth(field(b, "importedNodeId"));
                   });
  unsigned sequence = 0;
  for (const auto &row : additions) {
    auto n = node(imported, field(row, "importedNodeId"));
    auto id = text(field(n, "id"));
    while (ns.count(id)) {
      std::ostringstream s;
      s << "node_reimport_" << std::setw(4) << std::setfill('0') << ++sequence;
      id = s.str();
    }
    const auto original_id = field(n, "id");
    const auto parent = text(field(n, "parentId"));
    const auto parent_id =
        assignments.count(parent) ? assignments.at(parent) : root;
    auto &o = n.get<Object>();
    o["id"] = Value(id);
    o["parentId"] = parent_id;
    o["children"] = Value(Array{});
    if (source && o["sourceRef"].is<Object>())
      o["sourceRef"].get<Object>()["sourceAssetId"] = field(*source, "id");
    ns[id] = n;
    ns[text(parent_id)]
        .get<Object>()
        .at("children")
        .get<Array>()
        .emplace_back(id);
    assignments[text(original_id)] = Value(id);
  }
  if (source) {
    Value *art = nullptr;
    for (auto &a : next.get<Object>().at("keyArts").get<Array>())
      if (field(a, "sourceAssetId") == field(*source, "id")) {
        art = &a;
        break;
      }
    if (art) {
      auto &members = art->get<Object>().at("members").get<Array>();
      members.erase(std::remove_if(members.begin(), members.end(),
                                   [&](const Value &m) {
                                     return !ns.count(text(field(m, "nodeId")));
                                   }),
                    members.end());
      std::set<std::string> existing;
      double order = -1;
      for (const auto &m : members) {
        existing.insert(text(field(m, "nodeId")));
        order = std::max(order, field(m, "drawOrder").get<double>());
      }
      ++order;
      if (imported_source)
        for (const auto &a : field(imported, "keyArts").get<Array>())
          if (field(a, "sourceAssetId") == field(*imported_source, "id")) {
            for (const auto &m : field(a, "members").get<Array>()) {
              const auto imported_id = text(field(m, "nodeId"));
              if (!assignments.count(imported_id))
                continue;
              const auto id = text(assignments.at(imported_id));
              if (existing.count(id) || !ns.count(id))
                continue;
              auto member = m;
              member.get<Object>()["nodeId"] = Value(id);
              member.get<Object>()["appearanceId"] =
                  Value(text(field(*source, "id")) + ":" +
                        text(field(field(ns[id], "sourceRef"), "sourceKey")));
              member.get<Object>()["drawOrder"] = Value(order++);
              members.push_back(member);
              existing.insert(id);
            }
            break;
          }
    }
  }
  next.get<Object>()["canvas"] = field(imported, "canvas");
  return Value(Object{{"project", next},
                      {"importedNodeAssignments", Value(assignments)}});
}
Value review(const Value &request) {
  const auto &source = field(request, "source"),
             &current = field(source, "currentProject"),
             &imported = field(source, "importedProject");
  if (!fl2d_validation::valid_project(current) ||
      !fl2d_validation::valid_project(imported))
    cmd_error();
  auto rows = field(source, "rows").is<Array>()
                  ? field(source, "rows").get<Array>()
                  : analyze(current, imported);
  const auto operation = text(field(field(request, "options"), "operation"));
  if (operation == "change")
    change(current, imported, rows, field(source, "change"));
  else if (operation != "analyze" && operation != "build")
    cmd_error();
  return operation == "build" ? build(current, imported, rows)
                              : projection(current, imported, rows);
}
} // namespace fl2d_sources
