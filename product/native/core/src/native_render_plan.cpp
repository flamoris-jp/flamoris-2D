#include "native_render_plan.h"
#include "native_commands.h"
#include "native_frame_evaluation.h"
#include "native_queries.h"
#include "native_math.h"
#include "js_text.h"
#include <algorithm>
#include <functional>
#include <iomanip>
#include <locale>
#include <set>
#include <sstream>

namespace fl2d_render {
using namespace fl2d_commands;
static std::string text(const Value& v){return v.is<std::string>()?v.get<std::string>():"";}
static bool finite(const Value& v){return v.is<double>() && std::isfinite(v.get<double>());}
static bool present(const Value& v){return !text(v).empty();}
static std::string integer(const Value& v){return std::to_string(static_cast<int64_t>(v.get<double>()));}
static void error(const std::string& message){throw fl2d_queries::Error{"Error",message};}
static const Value& find(const Value& values,const Value& id){for(const auto& value:values.get<Array>())if(field(value,"id")==id)return value;error("Unknown render owner "+text(id)+".");throw std::logic_error("unreachable");}
static Value clipping(const Array& batches){
    std::map<std::string,Value> instances;Object contributions;Array masks;
    for(const auto& batch:batches){const bool weighted=field(batch,"kind")==Value("weighted-premultiplied");double total=0;for(const auto& instance:field(batch,"renderInstances").get<Array>())if(weighted)total+=field(instance,"compositeWeight").get<double>();
        for(const auto& instance:field(batch,"renderInstances").get<Array>()){const auto id=text(field(instance,"renderInstanceId"));if(instances.count(id))error("Duplicate evaluated render instance "+id+".");instances[id]=instance;contributions[id]=Value(weighted?field(instance,"compositeWeight").get<double>()/total:1);}
    }
    std::map<std::string,int> states;std::vector<std::string> stack;
    auto source=[&](const Value& instance){const auto& clip=field(instance,"clipping");const auto id=text(field(instance,"renderInstanceId"));if(field(clip,"mode")!=Value("inside"))error("Evaluated clipping mode "+text(field(clip,"mode"))+" is unsupported for "+id+".");const auto source_id=text(field(clip,"sourceRenderInstanceId"));if(source_id.empty())error("Evaluated clipping source is unresolved for "+id+".");return source_id;};
    std::function<void(const std::string&)> visit=[&](const std::string& id){
        if(states[id]==2)return;
        if(states[id]==1){auto cycle=std::vector<std::string>(std::find(stack.begin(),stack.end(),id),stack.end());std::sort(cycle.begin(),cycle.end(),fl2d_text::less);std::string message;for(const auto& member:cycle){if(!message.empty())message+=", ";message+=member;}error("Evaluated clipping dependency cycle includes "+message+".");}
        if(!instances.count(id))error("Evaluated clipping source "+id+" is unavailable.");
        states[id]=1;stack.push_back(id);const auto& instance=instances.at(id);if(field(instance,"clipping").is<Object>())visit(source(instance));stack.pop_back();states[id]=2;masks.emplace_back(id);
    };
    std::vector<std::string> targets;for(const auto& entry:instances)if(field(entry.second,"clipping").is<Object>())targets.push_back(entry.first);std::sort(targets.begin(),targets.end(),fl2d_text::less);for(const auto& target:targets)visit(source(instances.at(target)));
    return Value(Object{{"maskSourceIds",Value(masks)},{"contributions",Value(contributions)}});
}
Value plan(const Value& frame,const Value& artwork){
    Array unsupported,instances,usable;std::set<std::string> seen_reasons,available;
    auto reason=[&](const std::string& message){if(seen_reasons.insert(message).second)unsupported.emplace_back(message);};
    for(const auto& a:artwork.get<Array>())available.insert(a.is<std::string>()?text(a):text(field(a,"nodeId")));
    for(const auto& part:field(frame,"evaluatedParts").get<Array>()){
        const auto presence=text(field(part,"presence"));if(presence=="absent")continue;
        if(presence=="occluded"){if(!field(part,"renderInstances").get<Array>().empty())reason("Occluded part "+text(field(part,"semanticSlotId"))+" still requires visible render instances.");continue;}
        if(presence!="present"){reason("Unsupported presence state "+presence+" for "+text(field(part,"semanticSlotId"))+".");continue;}
        const auto& values=field(part,"renderInstances").get<Array>();instances.insert(instances.end(),values.begin(),values.end());
    }
    for(const auto& instance:instances){const auto id=text(field(instance,"renderInstanceId"));const auto& order=field(instance,"drawOrder"),&matrix=field(instance,"transform"),&opacity=field(instance,"opacity"),&mesh=field(instance,"mesh");
        if(!finite(order) || std::trunc(order.get<double>())!=order.get<double>() || std::abs(order.get<double>())>9007199254740991.0){reason("Render instance "+id+" has no supported explicit draw order.");continue;}
        if(!matrix.is<Array>() || matrix.get<Array>().size()!=6 || !std::all_of(matrix.get<Array>().begin(),matrix.get<Array>().end(),finite)){reason("Render instance "+id+" has an unsupported transform.");continue;}
        if(!finite(opacity) || opacity.get<double>()<0 || opacity.get<double>()>1){reason("Render instance "+id+" has an unsupported opacity.");continue;}
        if(!mesh.is<Object>() || !field(mesh,"positions").is<Array>() || !field(mesh,"indices").is<Array>() || field(mesh,"positions").get<Array>().size()%2 || field(mesh,"indices").get<Array>().size()%3){reason("Render instance "+id+" has unsupported mesh geometry.");continue;}
        const auto samples=field(instance,"appearanceSamples").is<Array>()?field(instance,"appearanceSamples").get<Array>():Array{};
        if(samples.empty() || samples.size()>2){reason("Render instance "+id+" requires "+std::to_string(samples.size())+" appearance samples; renderer supports 1..2.");continue;}
        bool supported=true;double total=0;
        for(const auto& sample:samples){const auto appearance=text(field(sample,"appearanceId"));if(!available.count(text(field(sample,"sourceNodeId")))){reason("Source artwork is unavailable for appearance "+appearance+".");supported=false;}
            const auto& uv=field(sample,"uvs");if(!uv.is<Array>() || uv.get<Array>().size()!=field(mesh,"positions").get<Array>().size()){reason("Per-Key-Art UVs are unavailable for appearance "+appearance+".");supported=false;}
            const auto& weight=field(sample,"weight");if(!finite(weight) || weight.get<double>()<0){reason("Appearance weight is invalid for "+appearance+".");supported=false;}else total+=weight.get<double>();
        }
        if(!(total>0)){reason("Appearance weights have no visible contribution for "+id+".");supported=false;}if(supported)usable.push_back(instance);
    }
    Array batches;std::map<std::string,Array> groups;std::vector<std::string> group_order;
    for(const auto& instance:usable){const auto group=text(field(instance,"compositeGroupId"));if(group.empty())batches.emplace_back(Object{{"kind",Value("instance")},{"drawOrder",field(instance,"drawOrder")},{"renderInstances",Value(Array{instance})}});else {if(!groups.count(group))group_order.push_back(group);groups[group].push_back(instance);}}
    for(const auto& id:group_order){auto& members=groups[id];if(std::any_of(members.begin(),members.end(),[](const Value& i){return !finite(field(i,"compositeWeight")) || field(i,"compositeWeight").get<double>()<0;})){reason("Composite group "+id+" has invalid weights.");continue;}
        double total=0;std::set<double> orders;for(const auto& i:members){total+=field(i,"compositeWeight").get<double>();orders.insert(field(i,"drawOrder").get<double>());}if(!(total>0)){reason("Composite group "+id+" has no visible contribution.");continue;}
        if(orders.size()!=1){std::string labels;for(const auto order:orders){if(!labels.empty())labels+=", ";labels+=integer(Value(order));}reason("Composite group "+id+" has inconsistent explicit draw order ("+labels+"); renderer cannot infer a composite layer.");continue;}
        std::stable_sort(members.begin(),members.end(),[](const Value& a,const Value& b){return field(a,"drawOrder").get<double>()<field(b,"drawOrder").get<double>() || (field(a,"drawOrder")==field(b,"drawOrder") && fl2d_text::less(text(field(a,"renderInstanceId")),text(field(b,"renderInstanceId"))));});
        batches.emplace_back(Object{{"kind",Value("weighted-premultiplied")},{"compositeGroupId",Value(id)},{"drawOrder",Value(*orders.begin())},{"renderInstances",Value(members)}});
    }
    std::map<double,unsigned> counts;std::vector<double> order_keys;for(const auto& batch:batches){const auto order=field(batch,"drawOrder").get<double>();if(!counts.count(order))order_keys.push_back(order);++counts[order];}for(const auto order:order_keys)if(counts[order]>1)reason("Multiple render batches conflict at explicit draw order "+integer(Value(order))+"; renderer cannot invent a z-order.");
    batches.erase(std::remove_if(batches.begin(),batches.end(),[&](const Value& b){return counts[field(b,"drawOrder").get<double>()]>1;}),batches.end());std::stable_sort(batches.begin(),batches.end(),[](const Value& a,const Value& b){return field(a,"drawOrder").get<double>()<field(b,"drawOrder").get<double>();});
    const auto& camera=field(frame,"camera");if(camera.is<Object>()){
        for(const auto key:{"positionX","positionY","rotation","scale"})if(!finite(field(camera,key)))error("Evaluated camera must contain finite position/rotation and positive scale.");
        if(field(camera,"scale").get<double>()<=0)error("Evaluated camera must contain finite position/rotation and positive scale.");
        const double rotation=-field(camera,"rotation").get<double>(),scale=field(camera,"scale").get<double>(),a=std::cos(rotation)*scale,b=std::sin(rotation)*scale,c=-std::sin(rotation)*scale,d=std::cos(rotation)*scale,x=field(camera,"positionX").get<double>(),y=field(camera,"positionY").get<double>();
        const fl2d_math::Affine projection{a,b,c,d,-(a*x+c*y),-(b*x+d*y)};
        for(auto& batch:batches)for(auto& instance:batch.get<Object>().at("renderInstances").get<Array>()){fl2d_math::Affine local{};const auto& matrix=field(instance,"transform").get<Array>();for(size_t i=0;i<6;++i)local[i]=matrix[i].get<double>();instance.get<Object>()["transform"]=fl2d_math::json(fl2d_math::multiply(projection,local));}
    }
    double count=0;for(const auto& batch:batches)count+=field(batch,"renderInstances").get<Array>().size();Object render{{"batches",Value(batches)},{"unsupportedReasons",Value(unsupported)},{"renderInstanceCount",Value(count)}};if(camera.is<Object>())render["camera"]=camera;
    auto clipped=clipping(batches);clipped.get<Object>()["plan"]=Value(render);return clipped;
}
Value projection(const Value& project,const Value& input){
    const auto& art_id=field(input,"keyArtId"),&transition_id=field(input,"transitionId"),&sequence_id=field(input,"sequenceId"),&ticks=field(input,"timeTicks");
    if(!finite(ticks) || ticks.get<double>()<0 || std::trunc(ticks.get<double>())!=ticks.get<double>() || ticks.get<double>()>9007199254740991.0)error("Expected non-negative integer Product ticks.");
    if(static_cast<int>(present(art_id))+static_cast<int>(present(transition_id))+static_cast<int>(present(sequence_id))!=1)error("Select exactly one Key Art, Transition or Sequence.");
    Value evaluated,owner;double duration=0;
    if(present(art_id))evaluated=fl2d_evaluation::keyart_frame(project,find(field(project,"keyArts"),art_id),Value("keyart:"+text(art_id)));
    else {const bool sequence=present(sequence_id);owner=find(field(project,sequence?"sequences":"transitions"),sequence?sequence_id:transition_id);evaluated=sequence?fl2d_evaluation::sequence_frame(project,owner,ticks.get<double>()):fl2d_evaluation::transition_frame(project,owner,ticks.get<double>());duration=field(find(field(project,"temporalPrograms"),field(owner,"temporalProgramId")),"durationTicks").get<double>();}
    auto result=plan(evaluated,field(input,"artwork"));if(!field(field(result,"plan"),"unsupportedReasons").get<Array>().empty()){std::string reasons;for(const auto& r:field(field(result,"plan"),"unsupportedReasons").get<Array>()){if(!reasons.empty())reasons+='\n';reasons+=text(r);}error(reasons);}
    Array images,authoring;std::set<std::string> used;for(const auto& batch:field(field(result,"plan"),"batches").get<Array>())for(const auto& instance:field(batch,"renderInstances").get<Array>())for(const auto& sample:field(instance,"appearanceSamples").get<Array>()){const auto id=text(field(sample,"sourceNodeId"));if(!used.insert(id).second)continue;for(const auto& image:field(input,"artwork").get<Array>())if(field(image,"nodeId")==field(sample,"sourceNodeId")){images.push_back(image);break;}}
    if(present(art_id))for(const auto& part:field(evaluated,"evaluatedParts").get<Array>()){Array forms;for(const auto& form:field(project,"meshKeyforms").get<Array>())if(field(form,"keyArtId")==art_id && field(form,"semanticSlotId")==field(part,"semanticSlotId"))forms.push_back(form);
        const auto& instances=field(part,"renderInstances").get<Array>();if(forms.size()!=1 || instances.size()!=1 || field(field(instances[0],"mesh"),"positions").get<Array>().size()!=field(forms[0],"positions").get<Array>().size())continue;
        authoring.emplace_back(Object{{"nodeId",field(instances[0],"sourceNodeId")},{"keyformId",field(forms[0],"id")},{"topologyId",field(forms[0],"topologyId")},{"positions",field(field(instances[0],"mesh"),"positions")},{"worldTransform",field(instances[0],"transform")}});
    }
    std::ostringstream label;label.imbue(std::locale::classic());label<<std::fixed<<std::setprecision(3)<<ticks.get<double>()/120000<<" 秒 · "<<integer(ticks)<<" ticks";
    auto& out=result.get<Object>();out["artwork"]=Value(images);out["authoringMeshes"]=Value(authoring);out["diagnostics"]=field(evaluated,"diagnostics");out["canvas"]=field(project,"canvas");out["timeTicks"]=ticks;out["durationTicks"]=Value(duration);out["timeLabel"]=Value(label.str());return result;
}
}
