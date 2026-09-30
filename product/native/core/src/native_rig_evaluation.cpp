#include "native_rig_evaluation.h"
#include "native_queries.h"
#include "js_text.h"
#include <algorithm>
#include <functional>
#include <limits>
#include <set>

namespace fl2d_evaluation {
namespace {
using fl2d_commands::field;
using fl2d_math::Affine;
constexpr Affine identity{1,0,0,1,0,0};
constexpr double pi = 3.14159265358979323846;
double num(const Value& v, const char* key) {
    const auto& value = field(v,key);
    return value.is<double>() ? value.get<double>() : std::numeric_limits<double>::quiet_NaN();
}
Value number(double x) { return std::isfinite(x) ? Value(x) : Value(); }
bool finite(const Value& v) { return v.is<double>() && std::isfinite(v.get<double>()); }
bool finite_point(const Value& v) { return finite(field(v,"x")) && finite(field(v,"y")); }
std::string str(const Value& v, const char* key) { return field(v,key).get<std::string>(); }
const Array& rig(const Value& p, const char* key) { return field(field(p,"rig"),key).get<Array>(); }
Value find(const Array& values, const Value& id, const char* key = "id") {
    for (const auto& v : values) if (field(v,key) == id) return v;
    return Value();
}
Value point(double x, double y) { return Value(Object{{"x",number(x)},{"y",number(y)}}); }
Value transform(const Affine& a, const Value& p) {
    return point(a[0]*num(p,"x")+a[2]*num(p,"y")+a[4],a[1]*num(p,"x")+a[3]*num(p,"y")+a[5]);
}
Affine affine(const Value& v) {
    Affine result{}; const auto& a = v.get<Array>();
    for (size_t i = 0; i < 6; ++i) result[i] = a.at(i).is<double>() ? a.at(i).get<double>() : std::numeric_limits<double>::quiet_NaN();
    return result;
}
Affine inverse(const Affine& m) {
    const double det = m[0]*m[3]-m[1]*m[2];
    if (!std::isfinite(det) || std::abs(det) < 1e-12)
        throw fl2d_queries::Error{"Error","Affine transform is not invertible."};
    const double inv = 1/det, a = m[3]*inv, b = -m[1]*inv, c = -m[2]*inv, d = m[0]*inv;
    return {a,b,c,d,-(a*m[4]+c*m[5]),-(b*m[4]+d*m[5])};
}
Affine local(const Value& v) {
    const double c = std::cos(num(v,"rotation")), s = std::sin(num(v,"rotation"));
    return {c,s,-s,c,num(v,"x"),num(v,"y")};
}
Value diag(const char* code, const char* message, Object extra = {}) {
    extra["code"] = Value(code); extra["message"] = Value(message); return Value(extra);
}
struct EvaluationFailure { std::string code, message; Value details; };
[[noreturn]] void fail(const char* code, const char* message, Object details = {}) {
    throw EvaluationFailure{code,message,Value(details)};
}
void sort(Array& values, std::initializer_list<const char*> keys) {
    std::stable_sort(values.begin(),values.end(),[&](const Value& a, const Value& b) {
        for (const auto key : keys) {
            const auto& l = field(a,key); const auto& r = field(b,key);
            const std::string left = l.is<std::string>() ? l.get<std::string>() : "";
            const std::string right = r.is<std::string>() ? r.get<std::string>() : "";
            if (left != right) return fl2d_text::less(left,right);
        }
        return false;
    });
}
Value delta(const Value& p, const Value& bone_id, const Value& art) {
    for (const auto& k : rig(p,"bonePoseKeyforms"))
        if (field(k,"boneId") == bone_id && field(k,"keyArtId") == art) return field(k,"localDelta");
    return Value(Object{{"x",Value(0.0)},{"y",Value(0.0)},{"rotation",Value(0.0)}});
}
Value constrained(const Value& p, const Value& bone_id, Value d) {
    Value constraint;
    for (const auto& c : rig(p,"boneRotationConstraints"))
        if (field(c,"boneId") == bone_id && field(c,"enabled") == Value(true)) { constraint = c; break; }
    if (!constraint.is<picojson::null>()) d.get<Object>()["rotation"] = Value(std::min(num(constraint,"maxRotation"),
        std::max(num(constraint,"minRotation"),num(d,"rotation"))));
    return d;
}
double shortest(double a, double b) {
    double d = std::fmod(b-a,2*pi);
    if (d > pi) d -= 2*pi;
    if (d < -pi) d += 2*pi;
    return d;
}
struct Stage { Value deformer; Affine from, to; Array base, authored; bool resolved = false; };
double lerp(double a, double b, double t) { return a+(b-a)*t; }
Value cell(const Array& a, size_t columns, size_t row, size_t col, double u, double v) {
    const size_t i = (row*columns+col)*2;
    auto channel = [&](size_t k) {
        return lerp(lerp(a[i+k].get<double>(),a[i+2+k].get<double>(),u),
            lerp(a[i+columns*2+k].get<double>(),a[i+columns*2+2+k].get<double>(),u),v);
    };
    return point(channel(0),channel(1));
}
double cross(const Value& a, const Value& b) { return num(a,"x")*num(b,"y")-num(a,"y")*num(b,"x"); }
Value subtract(const Value& a, const Value& b) { return point(num(a,"x")-num(b,"x"),num(a,"y")-num(b,"y")); }
Value at(const Array& a, size_t i) { return point(a[i*2].get<double>(),a[i*2+1].get<double>()); }
std::vector<double> quadratic(double a, double b, double c) {
    if (std::abs(a) <= 1e-12) return std::abs(b) <= 1e-12 ? std::vector<double>{} : std::vector<double>{-c/b};
    const double disc = b*b-4*a*c;
    if (disc < -1e-12) return {};
    const double root = std::sqrt(std::max(0.0,disc));
    return {(-b-root)/(2*a),(-b+root)/(2*a)};
}
Value map_lattice(const Stage& s, const Value& p) {
    const size_t columns = static_cast<size_t>(num(s.deformer,"columns")), rows = static_cast<size_t>(num(s.deformer,"rows"));
    bool found = false; double best_distance = 0, best_u = 0, best_v = 0; size_t best_row = 0, best_col = 0; Value best_point;
    for (size_t row = 0; row+1 < rows; ++row) for (size_t col = 0; col+1 < columns; ++col) {
        const size_t i = row*columns+col;
        const auto a = at(s.base,i), b = subtract(at(s.base,i+1),a), c = subtract(at(s.base,i+columns),a);
        const auto d = subtract(subtract(at(s.base,i+columns+1),a),point(num(b,"x")+num(c,"x"),num(b,"y")+num(c,"y")));
        const auto q = subtract(p,a); std::vector<std::pair<double,double>> candidates;
        for (const double v : quadratic(-cross(c,d),cross(q,d)-cross(c,b),cross(q,b))) {
            const double x = num(b,"x")+num(d,"x")*v, y = num(b,"y")+num(d,"y")*v, denominator = x*x+y*y;
            if (denominator > 1e-12) candidates.emplace_back(((num(q,"x")-num(c,"x")*v)*x+(num(q,"y")-num(c,"y")*v)*y)/denominator,v);
        }
        for (const double u : quadratic(-cross(b,d),cross(q,d)-cross(b,c),cross(q,c))) {
            const double x = num(c,"x")+num(d,"x")*u, y = num(c,"y")+num(d,"y")*u, denominator = x*x+y*y;
            if (denominator > 1e-12) candidates.emplace_back(u,((num(q,"x")-num(b,"x")*u)*x+(num(q,"y")-num(b,"y")*u)*y)/denominator);
        }
        for (const auto& candidate : candidates) {
            const double u = std::clamp(candidate.first,0.0,1.0), v = std::clamp(candidate.second,0.0,1.0);
            const auto source = cell(s.base,columns,row,col,u,v); const auto offset = subtract(p,source);
            const double distance = num(offset,"x")*num(offset,"x")+num(offset,"y")*num(offset,"y");
            if (!found || distance < best_distance-1e-10 || (std::abs(distance-best_distance) <= 1e-10 &&
                (row < best_row || (row == best_row && col < best_col)))) {
                found = true; best_distance = distance; best_row = row; best_col = col; best_u = u; best_v = v; best_point = source;
            }
        }
    }
    if (!found) fail("DEFORMER_KEYFORM_INCOMPATIBLE","Warp lattice mapping is not evaluable.",{{"deformerId",field(s.deformer,"id")}});
    const auto target = cell(s.authored,columns,best_row,best_col,best_u,best_v);
    return point(num(p,"x")+num(target,"x")-num(best_point,"x"),num(p,"y")+num(target,"y")-num(best_point,"y"));
}
Value warp_point(const Stage& s, const Value& p) {
    const auto q = transform(s.to,p); Value output;
    if (!finite_point(q)) fail("DEFORMER_CONTROL_POINT_INVALID","Warp evaluation requires finite point coordinates.");
    if (s.resolved) output = map_lattice(s,q);
    else {
        const auto& bounds = field(s.deformer,"bounds");
        const double width = num(bounds,"right")-num(bounds,"left"), height = num(bounds,"bottom")-num(bounds,"top");
        const size_t columns = static_cast<size_t>(num(s.deformer,"columns")), rows = static_cast<size_t>(num(s.deformer,"rows"));
        const double x = std::clamp((num(q,"x")-num(bounds,"left"))/width,0.0,1.0)*(columns-1);
        const double y = std::clamp((num(q,"y")-num(bounds,"top"))/height,0.0,1.0)*(rows-1);
        const size_t col = std::min(static_cast<size_t>(std::floor(x)),columns-2), row = std::min(static_cast<size_t>(std::floor(y)),rows-2);
        Array offsets; for (size_t i = 0; i < s.base.size(); ++i) offsets.emplace_back(s.authored[i].get<double>()-s.base[i].get<double>());
        const auto offset = cell(offsets,columns,row,col,x-col,y-row);
        output = point(num(q,"x")+num(offset,"x"),num(q,"y")+num(offset,"y"));
    }
    return transform(s.from,output);
}
std::vector<Stage> stages(const Value& p, const Value& bone_id, const Value& art) {
    const auto& nodes = field(field(p,"scene"),"nodes").get<Object>();
    std::vector<std::string> ids; const Value* node = &nodes.at(bone_id.get<std::string>());
    while (field(*node,"parentId").is<std::string>()) {
        node = &nodes.at(str(*node,"parentId"));
        if (field(*node,"kind") == Value("deformer")) ids.push_back(str(*node,"id"));
    }
    std::reverse(ids.begin(),ids.end()); std::vector<Stage> result;
    for (const auto& id : ids) {
        const auto deformer = find(rig(p,"deformers"),Value(id)); Value keyform;
        for (const auto& k : rig(p,"warpDeformerKeyforms"))
            if (field(k,"deformerId") == Value(id) && field(k,"keyArtId") == art) { keyform = k; break; }
        if (keyform.is<picojson::null>()) fail("DEFORMER_KEYFORM_MISSING","WarpDeformer has no keyform for this Key Art.",
            {{"code",Value("DEFORMER_KEYFORM_MISSING")},{"deformerId",Value(id)},{"keyArtId",art},{"nodeId",bone_id},
             {"message",Value("WarpDeformer has no keyform for this Key Art.")},{"boneId",bone_id}});
        const auto from = fl2d_math::world(p,id); Stage stage{deformer,from,inverse(from),{},{},false};
        const auto& bounds = field(deformer,"bounds");
        for (const auto& control_id : field(deformer,"controlPointIds").get<Array>()) {
            const auto control = find(rig(p,"warpControlPoints"),control_id);
            const auto position = find(field(keyform,"controlPoints").get<Array>(),control_id,"controlPointId");
            const double x = num(bounds,"left")+num(control,"u")*(num(bounds,"right")-num(bounds,"left"));
            const double y = num(bounds,"top")+num(control,"v")*(num(bounds,"bottom")-num(bounds,"top"));
            stage.base.emplace_back(x); stage.base.emplace_back(y);
            // Retain JS base + (authored - base) evaluation order.
            stage.authored.emplace_back(x+(num(position,"x")-x)); stage.authored.emplace_back(y+(num(position,"y")-y));
        }
        if (!result.empty()) {
            for (auto* lattice : {&stage.base,&stage.authored}) for (size_t i = 0; i < lattice->size(); i += 2) {
                auto projected = transform(from,point((*lattice)[i].get<double>(),(*lattice)[i+1].get<double>()));
                for (const auto& parent : result) projected = warp_point(parent,projected);
                (*lattice)[i] = field(projected,"x"); (*lattice)[i+1] = field(projected,"y");
            }
            stage.from = identity; stage.to = identity; stage.resolved = true;
        }
        result.push_back(std::move(stage));
    }
    return result;
}
Value mesh_result(const Value& positions, const Array& diagnostics = {}) {
    return Value(Object{{"mesh",Value(Object{{"positions",positions}})},{"diagnostics",Value(diagnostics)}});
}
Array spread(const Value& v) {
    if (v.is<Array>()) return v.get<Array>();
    if (v.is<picojson::null>() || v == Value(false) || v == Value(0.0)) return {};
    // String spreading follows UTF-16 surrogate-aware JS iteration.
    if (v.is<std::string>()) {
        Array out; const auto& s = v.get<std::string>();
        for (size_t i = 0; i < s.size();) {
            const unsigned char c = static_cast<unsigned char>(s[i]);
            const size_t length = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;
            out.emplace_back(s.substr(i,length)); i += length;
        }
        return out;
    }
    throw fl2d_queries::Error{"TypeError","((intermediate value) || []) is not iterable"};
}
}

Value bone_fk(const Value& p, const Value& art, bool projected, const std::map<std::string,Value>& overrides) {
    const auto& nodes = field(field(p,"scene"),"nodes").get<Object>();
    Array bones = rig(p,"bones"); sort(bones,{"id"}); Array order; std::set<std::string> visited;
    // Iterative parent walk avoids stack growth for admitted deep hierarchies.
    for (const auto& bone : bones) {
        std::vector<Value> chain; Value current = bone;
        while (!visited.count(str(current,"id"))) {
            chain.push_back(current); visited.insert(str(current,"id"));
            const auto& parent = nodes.at(str(nodes.at(str(current,"id")),"parentId"));
            if (field(parent,"kind") != Value("bone")) break;
            current = find(bones,field(parent,"id"));
        }
        for (auto it = chain.rbegin(); it != chain.rend(); ++it) order.push_back(*it);
    }
    std::map<std::string,Affine> unprojected, binds, poses; std::set<std::string> failed; Array results, diagnostics;
    for (const auto& bone : order) {
        const auto id = str(bone,"id"); const auto& parent = nodes.at(str(nodes.at(id),"parentId"));
        const Value parent_id = field(parent,"kind") == Value("bone") ? field(parent,"id") : Value();
        if (parent_id.is<std::string>() && failed.count(parent_id.get<std::string>())) {
            failed.insert(id); diagnostics.push_back(diag("BONE_PARENT_INVALID","Bone parent could not be evaluated.",
                {{"boneId",Value(id)},{"details",Value(Object{{"parentBoneId",parent_id}})}})); continue;
        }
        try {
            const auto local_bind = local(field(bone,"restLocalTransform"));
            const auto global_bind = parent_id.is<std::string>() ? fl2d_math::multiply(unprojected.at(parent_id.get<std::string>()),local_bind) : local_bind;
            unprojected[id] = global_bind;
            auto head = transform(global_bind,point(0,0)), tip = transform(global_bind,point(num(bone,"length"),0)), normal = transform(global_bind,point(0,num(bone,"length")));
            if (projected) {
                const Value* root = &nodes.at(id);
                while (field(*root,"kind") == Value("bone")) root = &nodes.at(str(*root,"parentId"));
                const auto world = fl2d_math::world(p,str(*root,"id")); const auto warp = stages(p,Value(id),art);
                for (auto* point_value : {&head,&tip,&normal}) {
                    *point_value = transform(world,*point_value);
                    for (const auto& stage : warp) *point_value = warp_point(stage,*point_value);
                }
            }
            for (const auto& entry : {std::make_pair("head",head),std::make_pair("tip",tip),std::make_pair("normal",normal)})
                if (!finite_point(entry.second)) fail("BONE_PROJECTED_FRAME_DEGENERATE","Bone bind-frame projection must produce finite points.",
                    {{"boneId",Value(id)},{"role",Value(entry.first)}});
            const double length = num(bone,"length");
            Affine bind{(num(tip,"x")-num(head,"x"))/length,(num(tip,"y")-num(head,"y"))/length,
                (num(normal,"x")-num(head,"x"))/length,(num(normal,"y")-num(head,"y"))/length,num(head,"x"),num(head,"y")};
            if (!std::all_of(bind.begin(),bind.end(),[](double x){return std::isfinite(x);}) || std::abs(bind[0]*bind[3]-bind[1]*bind[2]) < 1e-12)
                fail("BONE_PROJECTED_FRAME_DEGENERATE","Projected Bone bind frame is degenerate.",{{"boneId",Value(id)}});
            binds[id] = bind; auto d = overrides.count(id) ? overrides.at(id) : delta(p,Value(id),art);
            if (!finite_point(d) || !finite(field(d,"rotation")))
                fail("BONE_POSE_INVALID","Bone pose delta must contain finite x, y, and rotation.",{{"boneId",Value(id)},{"keyArtId",art}});
            d = field(bone,"enabled") == Value(true) ? constrained(p,Value(id),d) : Value(Object{{"x",Value(0.0)},{"y",Value(0.0)},{"rotation",Value(0.0)}});
            const auto dm = local(d);
            const auto pose = parent_id.is<std::string>() ? fl2d_math::multiply(fl2d_math::multiply(fl2d_math::multiply(poses.at(parent_id.get<std::string>()),inverse(binds.at(parent_id.get<std::string>()))),bind),dm) : fl2d_math::multiply(bind,dm);
            poses[id] = pose;
            results.emplace_back(Object{{"boneId",Value(id)},{"parentBoneId",parent_id},{"bindMatrix",fl2d_math::json(bind)},
                {"poseMatrix",fl2d_math::json(pose)},{"skinMatrix",fl2d_math::json(fl2d_math::multiply(pose,inverse(bind)))},
                {"head",transform(pose,point(0,0))},{"tip",transform(pose,point(length,0))}});
        } catch (const EvaluationFailure& error) {
            failed.insert(id); Object d{{"code",Value(error.code)},{"boneId",field(error.details,"boneId").is<std::string>() ? field(error.details,"boneId") : Value(id)},
                {"message",Value(error.message)}};
            if (!error.details.get<Object>().empty()) d["details"] = error.details;
            diagnostics.emplace_back(d);
        } catch (const fl2d_queries::Error& error) {
            failed.insert(id); diagnostics.push_back(diag("BONE_POSE_INVALID",error.message.c_str(),{{"boneId",Value(id)}}));
        }
    }
    sort(results,{"boneId"}); sort(diagnostics,{"code","boneId"});
    return Value(Object{{"poses",Value(results)},{"diagnostics",Value(diagnostics)}});
}

Value ik_chain(const Value& p, const Value& id, const Value& art) {
    const auto constraint = find(rig(p,"twoBoneIkConstraints"),id);
    if (constraint.is<picojson::null>()) return Value(Object{{"chain",Value()},{"diagnostics",Value(Array{diag("TWO_BONE_IK_NOT_FOUND","TwoBoneIkConstraint does not exist.",{{"details",Value(Object{{"constraintId",id}})}})})}});
    const auto fk = bone_fk(p,art,true);
    if (!field(fk,"diagnostics").get<Array>().empty()) return Value(Object{{"chain",Value()},{"diagnostics",field(fk,"diagnostics")}});
    Object chain{{"constraint",constraint}};
    for (const auto role : {"root","mid","end"}) chain[role] = find(field(fk,"poses").get<Array>(),field(constraint,std::string(role)+"BoneId"),"boneId");
    return Value(Object{{"chain",Value(chain)},{"diagnostics",Value(Array{})}});
}
Value solve_ik(const Value& p, const Value& input) {
    const auto id = field(input,"constraintId"), art = field(input,"keyArtId"), target = field(input,"target");
    const auto chain = ik_chain(p,id,art);
    auto rejected = [&](Array diagnostics) { return Value(Object{{"solution",Value()},{"diagnostics",Value(diagnostics)}}); };
    if (!field(chain,"diagnostics").get<Array>().empty()) return rejected(field(chain,"diagnostics").get<Array>());
    const auto& c = field(field(chain,"chain"),"constraint");
    if (field(c,"enabled") != Value(true)) return rejected({diag("TWO_BONE_IK_DISABLED","TwoBoneIkConstraint is disabled.",{{"details",Value(Object{{"constraintId",id}})}})});
    const auto& root = field(field(chain,"chain"),"root"); const auto& mid = field(field(chain,"chain"),"mid");
    for (const auto& pose : {root,mid}) {
        const auto m = affine(field(pose,"poseMatrix")); const double x = m[0]*m[0]+m[1]*m[1], y = m[2]*m[2]+m[3]*m[3], dot = m[0]*m[2]+m[1]*m[3], det = m[0]*m[3]-m[1]*m[2], scale = std::max({1.0,x,y});
        if (!(std::isfinite(x) && std::isfinite(y) && std::isfinite(dot) && std::isfinite(det) && x > 1e-9 && y > 1e-9 && std::abs(dot) <= 1e-9*scale && std::abs(x-y) <= 1e-9*scale && det > 1e-9))
            return rejected({diag("TWO_BONE_IK_PROJECTED_FRAME_INCOMPATIBLE","Two-bone IK requires orientation-preserving rigid projected Bone frames.",{{"details",Value(Object{{"constraintId",id},{"boneId",field(pose,"boneId")},{"poseMatrix",field(pose,"poseMatrix")}})}})});
    }
    auto length = [](const Value& pose) { return std::hypot(num(field(pose,"tip"),"x")-num(field(pose,"head"),"x"),num(field(pose,"tip"),"y")-num(field(pose,"head"),"y")); };
    auto angle = [](const Value& pose) { return std::atan2(num(field(pose,"tip"),"y")-num(field(pose,"head"),"y"),num(field(pose,"tip"),"x")-num(field(pose,"head"),"x")); };
    const double first = length(root), second = length(mid);
    if (!finite_point(target) || !std::isfinite(first) || !std::isfinite(second) || first <= 1e-12 || second <= 1e-12)
        return rejected({diag("TWO_BONE_IK_DEGENERATE_CHAIN","Two-bone IK requires finite points and two positive segment lengths.")});
    const double dx = num(target,"x")-num(field(root,"head"),"x"), dy = num(target,"y")-num(field(root,"head"),"y");
    const double requested = std::hypot(dx,dy), maximum = first+second, minimum = std::abs(first-second), distance = std::clamp(requested,minimum,maximum);
    const bool ccw = field(c,"bendDirection") == Value("counterclockwise"); double rr = 0, mr = 0;
    if (distance <= 1e-12 && std::abs(first-second) <= 1e-12) mr = ccw ? -pi : pi;
    else {
        const double cosine = std::clamp((distance*distance-first*first-second*second)/(2*first*second),-1.0,1.0);
        mr = (ccw ? -1 : 1)*std::acos(cosine);
        rr = (requested > 1e-12 ? std::atan2(dy,dx) : 0)-std::atan2(second*std::sin(mr),first+second*std::cos(mr));
    }
    const auto root_id = field(c,"rootBoneId"), mid_id = field(c,"midBoneId");
    const auto rd = constrained(p,root_id,delta(p,root_id,art)), md = constrained(p,mid_id,delta(p,mid_id,art));
    const double root_change = shortest(angle(root),rr); Value rs = rd;
    rs.get<Object>()["rotation"] = number(num(rd,"rotation")+root_change); rs = constrained(p,root_id,rs);
    const double applied = num(rs,"rotation")-num(rd,"rotation"), mid_change = shortest(angle(mid)+applied,rr+mr); Value ms = md;
    ms.get<Object>()["rotation"] = number(num(md,"rotation")+mid_change); ms = constrained(p,mid_id,ms);
    const auto fk = bone_fk(p,art,true,{{root_id.get<std::string>(),rs},{mid_id.get<std::string>(),ms}});
    const auto rp = find(field(fk,"poses").get<Array>(),root_id,"boneId"), mp = find(field(fk,"poses").get<Array>(),mid_id,"boneId"), ep = find(field(fk,"poses").get<Array>(),field(c,"endBoneId"),"boneId");
    const double elbow_x = num(field(root,"head"),"x")+first*std::cos(rr), elbow_y = num(field(root,"head"),"y")+first*std::sin(rr);
    Object solution{{"constraintId",id},{"keyArtId",art},{"target",target},{"bendDirection",field(c,"bendDirection")},
        {"reach",Value(requested > maximum ? "extended" : requested < minimum ? "folded" : "reachable")},
        {"limited",Value(num(rs,"rotation") != num(rd,"rotation")+root_change || num(ms,"rotation") != num(md,"rotation")+mid_change)},
        {"poseDeltas",Value(Array{Value(Object{{"boneId",root_id},{"keyArtId",art},{"localDelta",rs}}),Value(Object{{"boneId",mid_id},{"keyArtId",art},{"localDelta",ms}})})},
        {"end",ep.is<picojson::null>() ? point(elbow_x+second*std::cos(rr+mr),elbow_y+second*std::sin(rr+mr)) : field(ep,"head")},
        {"joints",rp.is<picojson::null>() || mp.is<picojson::null>() || ep.is<picojson::null>() ? Value() : Value(Object{{"root",field(rp,"head")},{"mid",field(mp,"head")},{"end",field(ep,"head")}})}};
    return Value(Object{{"solution",Value(solution)},{"diagnostics",field(fk,"diagnostics")}});
}

Value form(const Value& topology, const Value& keyform, const Value& positions) {
    if (keyform.is<picojson::null>()) return mesh_result(Value(spread(positions)));
    Array issues; auto d = [&](const char* code,const char* message,Object extra = {}) {
        Object fields{{"correctionId",Value()},{"topologyId",field(topology,"id")},{"vertexId",Value()}};
        for (const auto& entry : extra) fields[entry.first] = entry.second;
        return diag(code,message,fields);
    };
    const auto copied = spread(positions);
    if (topology.is<picojson::null>() || !positions.is<Array>() || positions.get<Array>().size() != field(topology,"vertexIds").get<Array>().size()*2)
        issues.push_back(d("MESH_FORM_CORRECTION_TOPOLOGY_INVALID","Form correction requires one finite x/y position per stable topology vertex."));
    if (!std::all_of(copied.begin(),copied.end(),finite)) issues.push_back(d("MESH_FORM_CORRECTION_POSITION_INVALID","Form correction requires finite mesh positions."));
    if (field(keyform,"topologyId") != field(topology,"id")) issues.push_back(d("MESH_FORM_CORRECTION_TOPOLOGY_INCOMPATIBLE","Form correction topology does not match evaluated geometry.",
        {{"correctionId",field(keyform,"id")},{"details",Value(Object{{"correctionTopologyId",field(keyform,"topologyId")}})}}));
    sort(issues,{"code","correctionId"});
    if (!topology.is<picojson::null>()) for (const auto& offset : field(keyform,"vertexOffsets").get<Array>()) {
        const auto& ids = field(topology,"vertexIds").get<Array>();
        if (std::find(ids.begin(),ids.end(),field(offset,"vertexId")) == ids.end())
            issues.push_back(d("MESH_FORM_CORRECTION_VERTEX_MISSING","Form correction references a stable vertex outside evaluated topology.",{{"correctionId",field(keyform,"id")},{"vertexId",field(offset,"vertexId")}}));
    }
    if (!issues.empty()) return mesh_result(Value(copied),issues);
    Array output = copied; const auto& ids = field(topology,"vertexIds").get<Array>();
    for (size_t i = 0; i < ids.size(); ++i) for (const auto& offset : field(keyform,"vertexOffsets").get<Array>()) if (field(offset,"vertexId") == ids[i]) {
        output[i*2] = number(output[i*2].get<double>()+num(offset,"x")); output[i*2+1] = number(output[i*2+1].get<double>()+num(offset,"y"));
    }
    return mesh_result(Value(output));
}

Value skin(const Value& p, const Value& binding, const Value& art, const Value& positions) {
    const auto fk = bone_fk(p,art,true);
    if (!field(fk,"diagnostics").get<Array>().empty()) {
        if (!positions.is<Array>() && !positions.is<std::string>()) throw fl2d_queries::Error{"TypeError","input.positions is not iterable"};
        return mesh_result(Value(spread(positions)),field(fk,"diagnostics").get<Array>());
    }
    if (field(binding,"enabled") == Value(false)) return mesh_result(Value(spread(positions)));
    const auto topology = find(field(p,"meshTopologies").get<Array>(),field(binding,"topologyId"));
    const auto& ids = field(topology,"vertexIds").get<Array>(); Array issues;
    auto d = [&](const char* code,const char* message,Object extra = {}) {
        Object fields{{"bindingId",field(binding,"id")},{"topologyId",field(topology,"id")},{"vertexId",Value()},{"boneId",Value()}};
        for (const auto& entry : extra) fields[entry.first] = entry.second;
        return diag(code,message,fields);
    };
    if (!positions.is<Array>() || !std::all_of(positions.get<Array>().begin(),positions.get<Array>().end(),finite))
        issues.push_back(d("SKIN_MESH_POSITION_INVALID","Skinning requires a flat finite mesh position array."));
    const Value count = positions.is<Array>() ? Value(static_cast<double>(positions.get<Array>().size())) : positions.is<std::string>() ? Value(static_cast<double>(fl2d_text::utf16(positions.get<std::string>()).size())) : Value();
    if (count != Value(static_cast<double>(ids.size()*2))) issues.push_back(d("SKIN_MESH_POSITION_COUNT_MISMATCH","Skinning requires exactly two position values per stable topology vertex.",
        {{"details",Value(Object{{"positionCount",count},{"vertexCount",Value(static_cast<double>(ids.size()))}})}}));
    const auto world = fl2d_math::world(p,str(binding,"targetNodeId"));
    const bool valid_world = std::all_of(world.begin(),world.end(),[](double x){return std::isfinite(x);}) && std::abs(world[0]*world[3]-world[1]*world[2]) >= 1e-12;
    if (!valid_world) issues.push_back(d("SKIN_GEOMETRY_TRANSFORM_INVALID","Skinning requires an invertible finite target world transform."));
    std::map<std::string,Affine> matrices;
    for (const auto& pose : field(fk,"poses").get<Array>()) {
        const auto& matrix = field(pose,"skinMatrix");
        if (!std::all_of(matrix.get<Array>().begin(),matrix.get<Array>().end(),finite))
            issues.push_back(d("SKIN_BONE_POSE_INVALID","Skinning requires a finite affine skin matrix for every evaluated Bone pose.",{{"boneId",field(pose,"boneId")}}));
        else matrices[str(pose,"boneId")] = valid_world ? fl2d_math::multiply(fl2d_math::multiply(inverse(world),affine(matrix)),world) : affine(matrix);
    }
    Array weights = field(binding,"vertexWeights").get<Array>(); sort(weights,{"vertexId"});
    for (const auto& w : weights) for (const auto& influence : field(w,"influences").get<Array>()) if (!matrices.count(str(influence,"boneId")))
        issues.push_back(d("SKIN_BONE_POSE_MISSING","Skin influence references a Bone without an evaluated FK pose.",{{"vertexId",field(w,"vertexId")},{"boneId",field(influence,"boneId")}}));
    if (!issues.empty()) { sort(issues,{"code","bindingId","topologyId","vertexId","boneId","message"}); return mesh_result(Value(spread(positions)),issues); }
    Array output;
    for (size_t i = 0; i < ids.size(); ++i) {
        const auto weight = find(weights,ids[i],"vertexId"); Array influences = field(weight,"influences").get<Array>(); sort(influences,{"boneId"});
        double sum = 0; for (const auto& influence : influences) sum += num(influence,"weight");
        double normalized_sum = 0, x = 0, y = 0;
        for (size_t j = 0; j < influences.size(); ++j) {
            const auto& influence = influences[j]; const double w = j+1 == influences.size() ? 1-normalized_sum : num(influence,"weight")/sum; normalized_sum += w;
            const auto v = transform(matrices.at(str(influence,"boneId")),point(positions.get<Array>()[i*2].get<double>(),positions.get<Array>()[i*2+1].get<double>()));
            x += w*num(v,"x"); y += w*num(v,"y");
        }
        output.push_back(number(x)); output.push_back(number(y));
    }
    return mesh_result(Value(output));
}
}
