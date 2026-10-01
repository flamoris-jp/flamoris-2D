#ifdef NDEBUG
#undef NDEBUG
#endif
#include "flamoris2d_core.h"
#include "picojson.h"
#include <cassert>
#include <cstdio>
#include <fstream>
#include <vector>
int main(){
    using Value=picojson::value;using Object=picojson::object;
    std::ifstream projects(FL2D_PROJECT_FIXTURES);Value all;assert(picojson::parse(all,projects).empty());const auto project=all.get<picojson::array>()[0].get<Object>().at("project").serialize();fl2d_session* session=nullptr;assert(fl2d_session_create(reinterpret_cast<const uint8_t*>(project.data()),static_cast<uint32_t>(project.size()),&session)==FL2D_OK);
    std::ifstream file(FL2D_RENDER_PLAN_FIXTURES);Value fixtures;assert(picojson::parse(fixtures,file).empty());
    for(const auto& item:fixtures.get<picojson::array>()){
        const auto& test=item.get<Object>();const auto request=Value(Object{{"name",Value("native.render_plan")},{"input",test.at("input")}}).serialize();uint32_t required=0;
        auto query=[&](char* b,uint32_t n){return fl2d_session_query_json(session,reinterpret_cast<const uint8_t*>(request.data()),static_cast<uint32_t>(request.size()),b,n,&required);};
        assert(query(nullptr,0)==FL2D_BUFFER_TOO_SMALL);std::vector<char> bytes(required);assert(query(bytes.data(),required)==FL2D_OK);Value result;assert(picojson::parse(result,std::string(bytes.data(),required-1)).empty());
        const bool equal=test.count("error")?result.get<Object>().at("error").get<Object>().at("message")==test.at("error"):result.get<Object>().at("value")==test.at("expected");
        if(!equal){fprintf(stderr,"Render plan differs: %s\n%s\n",test.at("name").get<std::string>().c_str(),result.serialize().c_str());assert(false);}
    }
    fl2d_session_destroy(session);puts("Native render and clipping plan conformance passed.");
}
