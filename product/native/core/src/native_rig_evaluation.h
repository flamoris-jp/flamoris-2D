#pragma once
#include "native_commands.h"
#include "native_math.h"
#include <map>
#include <set>
namespace fl2d_evaluation {
using fl2d_commands::Value;
using fl2d_commands::Object;
using fl2d_commands::Array;
// Pure projections of the existing session snapshot, shared by frame evaluation.
Value authoring_point(const Value& project,const Value& node_id,const Value& key_art,const Value& document_point,bool bone_pose=false,bool parent_local=false);
Value deformer_lattice(const Value& project,const Value& deformer,const Value& key_art,const Value& control_points);
Value bone_fk(const Value& project, const Value& key_art, bool projected = false,
    const std::map<std::string, Value>& pose_overrides = {},
    const std::map<std::string, Value>& warp_overrides = {}, const Value& morph_to = Value(), std::set<std::string>* active_warps = nullptr);
Value ik_chain(const Value& project, const Value& constraint_id, const Value& key_art);
Value solve_ik(const Value& project, const Value& input);
Value skin(const Value& project, const Value& binding, const Value& key_art, const Value& positions);
Value form(const Value& topology, const Value& keyform, const Value& positions);
Value skin_mesh(const Value& binding, const Value& topology, const Value& fk,
    const Value& positions, const fl2d_math::Affine& world);
Value warp_mesh(const Value& project, const Value& node_id, const Value& key_art,
    const Value& positions, const fl2d_math::Affine& world,
    const std::map<std::string, Value>& warp_overrides = {}, const Value& to_node = Value(), const Value& morph_to = Value(), std::set<std::string>* active_warps = nullptr);
Value morph_rig(const Value& project, const Value& from_art, const Value& to_art, double weight);
}
