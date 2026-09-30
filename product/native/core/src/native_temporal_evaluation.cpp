#include "native_temporal_evaluation.h"
#include "native_queries.h"
#include "native_commands.h"
#include "js_text.h"
#include "wide_ticks.h"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <set>
#include <string>
#include <vector>

namespace fl2d_evaluation {
namespace {
using namespace fl2d_commands;
using fl2d_ticks::UInt128;
[[noreturn]] void range(const std::string& message) { throw fl2d_queries::Error{"RangeError",message}; }
bool safe(const Value& value, bool positive = false) {
    return value.is<double>() && std::isfinite(value.get<double>()) && std::trunc(value.get<double>()) == value.get<double>() &&
        value.get<double>() >= (positive ? 1 : 0) && value.get<double>() <= static_cast<double>(fl2d_ticks::max_safe);
}
Value number(double n) { return std::isfinite(n) ? Value(n) : Value(); }
uint64_t integer(const UInt128& value, const char* label) {
    if (!value.safe()) range(std::string(label)+" exceeds the safe integer range.");
    return value.low();
}
void ordered(Array& values, const std::vector<const char*>& keys, const char* id = "id") {
    std::stable_sort(values.begin(),values.end(),[&](const Value& a, const Value& b) {
        for (const auto key : keys) {
            const auto left = field(a,key).get<double>(), right = field(b,key).get<double>();
            if (left != right) return left < right;
        }
        return fl2d_text::less(field(a,id).get<std::string>(),field(b,id).get<std::string>());
    });
}
Value canonical(Value value) {
    if (value.is<Array>()) for (auto& item : value.get<Array>()) item = canonical(std::move(item));
    else if (value.is<Object>()) {
        auto keys = value.get<Object>().keys(); std::sort(keys.begin(),keys.end(),fl2d_text::less); Object result;
        for (const auto& key : keys) result.emplace(key,canonical(value.get<Object>().at(key)));
        value = Value(result);
    }
    return value;
}
double cubic(double t, double a, double b) {
    const double inverse = 1-t;
    return 3*inverse*inverse*t*a+3*inverse*t*t*b+t*t*t;
}
double bezier(double progress, const Value& curve) {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    double low = 0, high = 1;
    for (int i = 0; i < 60; ++i) {
        const double middle = (low+high)/2;
        if (cubic(middle,field(curve,"x1").get<double>(),field(curve,"x2").get<double>()) < progress) low = middle;
        else high = middle;
    }
    return cubic((low+high)/2,field(curve,"y1").get<double>(),field(curve,"y2").get<double>());
}
Value interpolate(const Value& from, const Value& to, double progress) {
    if (from.is<double>() && to.is<double>()) return number(from.get<double>()+(to.get<double>()-from.get<double>())*progress);
    if (from.is<Object>() && to.is<Object>()) {
        std::set<std::string,decltype(&fl2d_text::less)> keys(&fl2d_text::less);
        for (const auto& key : from.get<Object>().keys()) keys.insert(key);
        for (const auto& key : to.get<Object>().keys()) keys.insert(key);
        Object result;
        for (const auto& key : keys) {
            const auto left = field(from,key).is<picojson::null>() ? Value(0.0) : field(from,key);
            const auto right = field(to,key).is<picojson::null>() ? Value(0.0) : field(to,key);
            if (left.is<double>() && right.is<double>()) result[key] = number(left.get<double>()+(right.get<double>()-left.get<double>())*progress);
            else if (left == right) result[key] = left;
            else return from;
        }
        return Value(result);
    }
    return from;
}
Value sample_channel(const Value& channel, uint64_t time, bool angle) {
    // sort_program has already canonicalized these frames by tick/stable ID.
    const auto& keys = field(channel,"keyframes").get<Array>();
    if (keys.empty()) return Value();
    const auto tick = static_cast<double>(time);
    if (tick <= field(keys.front(),"timeTicks").get<double>()) return field(keys.front(),"value");
    if (tick >= field(keys.back(),"timeTicks").get<double>()) return field(keys.back(),"value");
    size_t next = 1;
    while (field(keys[next],"timeTicks").get<double>() < tick) ++next;
    if (field(keys[next],"timeTicks").get<double>() == tick) return field(keys[next],"value");
    const auto& previous = keys[next-1]; const auto& curve = field(previous,"interpolationToNext");
    if (field(curve,"kind") == Value("step")) return field(previous,"value");
    const auto before = field(previous,"timeTicks").get<double>();
    const auto raw = (tick-before)/(field(keys[next],"timeTicks").get<double>()-before);
    const auto progress = field(curve,"kind") == Value("bezier") ? bezier(raw,curve) : raw;
    const auto& from = field(previous,"value"); const auto& to = field(keys[next],"value");
    if (!angle) return interpolate(from,to,progress);
    const double pi = std::acos(-1.0), two_pi = pi*2;
    double delta = std::fmod(to.get<double>()-from.get<double>(),two_pi);
    if (delta > pi) delta -= two_pi;
    if (delta < -pi) delta += two_pi;
    return number(from.get<double>()+delta*progress);
}
Value frame(uint64_t index, uint64_t n, uint64_t d) {
    const auto numerator = UInt128(index).times(120000).times(d);
    const auto divided = numerator.divmod(UInt128(n)); const bool exact = divided.second.zero();
    const auto ticks = integer(exact ? divided.first : fl2d_ticks::round_half_up(numerator,n),"Tick value");
    return Value(Object{{"frameIndex",Value(static_cast<double>(index))},{"timeTicks",Value(static_cast<double>(ticks))},{"exact",Value(exact)}});
}
}
Value sort_program(Value value) {
    auto& object = value.get<Object>(); auto& tracks = object.at("tracks").get<Array>(); ordered(tracks,{},"trackId");
    for (auto& track : tracks) {
        auto& channels = track.get<Object>().at("channels").get<Object>();
        for (auto& [name,channel] : channels) { (void)name; ordered(channel.get<Object>().at("keyframes").get<Array>(),{"timeTicks"}); }
    }
    ordered(object.at("events").get<Array>(),{"timeTicks"});
    ordered(object.at("regions").get<Array>(),{"startTicks","endTicks"});
    return canonical(std::move(value));
}
Value sample_program(const Value& program, const Value& time) {
    if (!safe(time) || time.get<double>() > field(program,"durationTicks").get<double>())
        range("Sample time must be within the TemporalProgram duration.");
    const auto projection = sort_program(program); Array tracks,events,regions;
    for (const auto& track : field(projection,"tracks").get<Array>()) {
        Object values; const auto& channels = field(track,"channels").get<Object>(); const auto kind = field(track,"kind").get<std::string>();
        for (const auto& name : channels.keys()) {
            const bool angle = name == "rotation" && (kind == "BoneTrack" || kind == "TransformTrack" || kind == "CameraTrack");
            values[name] = sample_channel(channels.at(name),static_cast<uint64_t>(time.get<double>()),angle);
        }
        tracks.emplace_back(Object{{"trackId",field(track,"trackId")},{"kind",field(track,"kind")},{"target",field(track,"target")},{"values",Value(values)}});
    }
    for (const auto& event : field(projection,"events").get<Array>()) if (field(event,"timeTicks") == time) events.push_back(event);
    for (const auto& region : field(projection,"regions").get<Array>())
        if (field(region,"startTicks").get<double>() <= time.get<double>() && time.get<double>() <= field(region,"endTicks").get<double>()) regions.push_back(region);
    return Value(Object{{"programId",field(program,"id")},{"timeTicks",time},{"tracks",Value(tracks)},{"events",Value(events)},{"regions",Value(regions)}});
}
Value clip_projection(const Value& instance, uint64_t time, uint64_t duration) {
    const uint64_t start = static_cast<uint64_t>(field(instance,"startTicks").get<double>()), end = static_cast<uint64_t>(field(instance,"endTicks").get<double>());
    const bool active = field(instance,"enabled") == Value(true) && time >= start && time < end;
    Object result{{"active",Value(active)},{"clipInstanceId",field(instance,"id")},{"clipId",field(instance,"clipId")},{"loopMode",field(instance,"loopMode")}};
    if (!active) return Value(result);
    const auto& rate = field(instance,"playbackRate");
    const auto raw = integer(fl2d_ticks::local_tick(time-start,static_cast<uint64_t>(field(instance,"sourceOffsetTicks").get<double>()),
        static_cast<uint64_t>(field(rate,"numerator").get<double>()),static_cast<uint64_t>(field(rate,"denominator").get<double>())),"Rounded ratio");
    const auto mode = field(instance,"loopMode").get<std::string>(); uint64_t local = raw;
    if (mode == "once") { if (raw > duration) range("Once ClipInstance local tick exceeds the AnimationClip duration."); }
    else if (mode == "loop") { if (!duration) range("Loop AnimationClip duration must be positive."); local = raw%duration; }
    else range("ClipInstance loopMode must be once or loop.");
    result["rawLocalTick"] = Value(static_cast<double>(raw)); result["localTick"] = Value(static_cast<double>(local));
    return Value(result);
}
Value export_frame(const Value& plan,const Value& index) {
    if (!safe(index) || index.get<double>() >= field(plan,"frameCount").get<double>()) range("Export frame index must be within the planned frame range.");
    const auto& rate = field(plan,"frameRate");
    return frame(static_cast<uint64_t>(index.get<double>()),static_cast<uint64_t>(field(rate,"numerator").get<double>()),static_cast<uint64_t>(field(rate,"denominator").get<double>()));
}

Value frame_plan(uint64_t duration, const Value& rate) {
    if (!duration || duration > fl2d_ticks::max_safe) range("Export durationTicks must be a positive safe integer.");
    const auto& numerator = field(rate,"numerator"); const auto& denominator = field(rate,"denominator");
    if (!safe(numerator,true) || !safe(denominator,true)) range("Frame rate numerator and denominator must be positive safe integers.");
    uint64_t n = static_cast<uint64_t>(numerator.get<double>()), d = static_cast<uint64_t>(denominator.get<double>());
    const auto gcd = std::gcd(n,d); n /= gcd; d /= gcd;
    const auto dividend = UInt128(duration).times(n), divisor = UInt128(120000).times(d);
    const auto divided = dividend.divmod(divisor);
    auto count = integer(divided.second.zero() ? divided.first : divided.first.plus(UInt128(1)),"Export frame count");
    const auto end_divided = UInt128(duration*2-1).times(n).divmod(divisor.times(2));
    const auto end = integer(end_divided.second.zero() ? end_divided.first : end_divided.first.plus(UInt128(1)),"Export frame count");
    count = std::min(count,end);
    if (!count) range("Export frame index must be within the planned frame range.");
    return Value(Object{{"durationTicks",Value(static_cast<double>(duration))},{"timebaseTicksPerSecond",Value(120000.0)},
        {"frameRate",Value(Object{{"numerator",Value(static_cast<double>(n))},{"denominator",Value(static_cast<double>(d))}})},
        {"frameCount",Value(static_cast<double>(count))},{"boundary",Value(Object{{"start",Value("inclusive")},{"end",Value("exclusive")}})},
        {"firstFrame",frame(0,n,d)},{"lastFrame",frame(count-1,n,d)}});
}
}
