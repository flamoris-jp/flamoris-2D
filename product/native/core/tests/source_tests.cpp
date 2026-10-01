#ifdef NDEBUG
#undef NDEBUG
#endif
#include "flamoris2d_core.h"
#include "picojson.h"
#include <cassert>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

int main() {
    std::ifstream stream(FL2D_SOURCE_INGEST_FIXTURES);assert(stream.good());picojson::value fixtures;assert(picojson::parse(fixtures,stream).empty());
    for(const auto& item:fixtures.get<picojson::array>()) {
        const auto& test=item.get<picojson::object>();const auto request=test.at("request").serialize();uint32_t size=0;
        auto query=[&](char* b,uint32_t c){return fl2d_source_project_json(reinterpret_cast<const uint8_t*>(request.data()),static_cast<uint32_t>(request.size()),b,c,&size);};
        assert(query(nullptr,0)==FL2D_BUFFER_TOO_SMALL && size>0);std::vector<char> buffer(size);assert(query(buffer.data(),size)==FL2D_OK);
        picojson::value actual;assert(picojson::parse(actual,std::string(buffer.data(),size-1)).empty());
        if(actual.get<picojson::object>().at("value")!=test.at("expected")){fprintf(stderr,"source differs: %s\n",test.at("name").get<std::string>().c_str());assert(false);}
    }
    // Restoring an automatic mapping must reject an imported layer already
    // claimed by another manual row, just like the JS review's mutateRow.
    for(const auto& item:fixtures.get<picojson::array>()) {
        const auto& test=item.get<picojson::object>();
        if(test.at("name")!=picojson::value("add-missing analyze"))continue;
        auto request=test.at("request");auto rows=test.at("expected").get<picojson::object>().at("rows");
        auto& entries=rows.get<picojson::array>();assert(entries.size()==2);
        const auto imported=entries[0].get<picojson::object>().at("importedNodeId");
        entries[0].get<picojson::object>()["action"]=picojson::value("ignore");
        entries[1].get<picojson::object>()["action"]=picojson::value("update");
        entries[1].get<picojson::object>()["importedNodeId"]=imported;
        auto& source=request.get<picojson::object>().at("source").get<picojson::object>();
        source["rows"]=rows;source["change"]=picojson::value(picojson::object{{"rowId",entries[0].get<picojson::object>().at("id")},{"action",picojson::value("auto")}});
        request.get<picojson::object>().at("options").get<picojson::object>()["operation"]=picojson::value("change");
        const auto json=request.serialize();uint32_t required=123;
        assert(fl2d_source_project_json(reinterpret_cast<const uint8_t*>(json.data()),static_cast<uint32_t>(json.size()),nullptr,0,&required)==FL2D_INVALID_ARGUMENT && required==0);
    }
    puts("Native source candidate conformance passed.");
}
