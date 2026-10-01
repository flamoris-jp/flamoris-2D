#ifdef NDEBUG
#undef NDEBUG
#endif
#include "flamoris2d_core.h"
#include "picojson.h"
#include <cassert>
#include <cstdio>
#include <fstream>
#include <functional>
#include <string>
#include <vector>

using Value=picojson::value;
using Object=picojson::object;
using Read=std::function<fl2d_status(char*,uint32_t,uint32_t*)>;
static Value read(const Read& query) {
    uint32_t size=0;assert(query(nullptr,0,&size)==FL2D_BUFFER_TOO_SMALL && size>0);
    std::vector<char> buffer(size);assert(query(buffer.data(),size,&size)==FL2D_OK && buffer.back()==0);
    Value result;assert(picojson::parse(result,std::string(buffer.data(),size-1)).empty());return result;
}
int main() {
    std::ifstream stream(FL2D_DOCUMENT_FIXTURES);assert(stream.good());Value fixtures;assert(picojson::parse(fixtures,stream).empty());
    for(const auto& item:fixtures.get<Object>().at("parse").get<picojson::array>()) {
        const auto& test=item.get<Object>();const auto source=test.at("source").serialize();
        const auto actual=read([&](char* b,uint32_t c,uint32_t* n){return fl2d_document_parse_json(reinterpret_cast<const uint8_t*>(source.data()),static_cast<uint32_t>(source.size()),b,c,n);});
        if(test.count("error")) {
            const auto& error=actual.get<Object>().at("error").get<Object>();
            if(error.at("code")!=test.at("error")) {fprintf(stderr,"parse error differs: %s: %s\n",test.at("name").get<std::string>().c_str(),actual.serialize().c_str());assert(false);}
            assert(error.at("details")==test.at("details"));
        }else if(actual.get<Object>().at("value")!=test.at("expected")) {
            fprintf(stderr,"parse differs: %s\n",test.at("name").get<std::string>().c_str());assert(false);
        }
    }
    for(const auto& item:fixtures.get<Object>().at("serialize").get<picojson::array>()) {
        const auto& test=item.get<Object>();const auto source=test.at("project").serialize(),options=test.at("options").serialize();
        fl2d_session* session=nullptr;assert(fl2d_session_create(reinterpret_cast<const uint8_t*>(source.data()),static_cast<uint32_t>(source.size()),&session)==FL2D_OK);
        fl2d_session_state before{},after{};assert(fl2d_session_state_get(session,&before)==FL2D_OK);
        const auto actual=read([&](char* b,uint32_t c,uint32_t* n){return fl2d_session_document_json(session,reinterpret_cast<const uint8_t*>(options.data()),static_cast<uint32_t>(options.size()),b,c,n);});
        if(actual.get<Object>().at("value")!=test.at("expected")) {fprintf(stderr,"serialize differs: %s\n",test.at("name").get<std::string>().c_str());assert(false);}
        assert(fl2d_session_state_get(session,&after)==FL2D_OK && before.current_revision==after.current_revision && before.dirty==after.dirty);
        const auto serialized=actual.get<Object>().at("value").serialize();
        const auto reopened=read([&](char* b,uint32_t c,uint32_t* n){return fl2d_document_parse_json(reinterpret_cast<const uint8_t*>(serialized.data()),static_cast<uint32_t>(serialized.size()),b,c,n);});
        auto expected=test.at("expected").get<Object>().at("project");expected.get<Object>()["id"]=test.at("project").get<Object>().at("id");expected.get<Object>()["displayName"]=test.at("project").get<Object>().at("displayName");
        assert(reopened.get<Object>().at("value").get<Object>().at("project")==expected);
        fl2d_session_destroy(session);
    }
    // A real Project can exceed the original 1 MiB proof snapshot bound.
    // The session/document path shares validation without inheriting that proof limit.
    auto large=fixtures.get<Object>().at("serialize").get<picojson::array>().front().get<Object>().at("project");
    large.get<Object>()["metadata"]=Value(std::string(FL2D_SNAPSHOT_MAX_BYTES+1,'x'));
    const auto large_json=large.serialize();fl2d_session* large_session=nullptr;
    assert(fl2d_session_create(reinterpret_cast<const uint8_t*>(large_json.data()),static_cast<uint32_t>(large_json.size()),&large_session)==FL2D_OK);
    const auto root=large.get<Object>().at("scene").get<Object>().at("rootId");
    const auto command=Value(picojson::array{Value(Object{{"type",Value("scene.rename_node")},{"payload",Value(Object{{"nodeId",root},{"displayName",Value("large project")}})}})}).serialize();
    fl2d_prepared* prepared=nullptr;
    assert(fl2d_session_prepare(large_session,reinterpret_cast<const uint8_t*>(command.data()),static_cast<uint32_t>(command.size()),"large",&prepared)==FL2D_OK);
    assert(fl2d_prepared_commit(prepared)==FL2D_OK);fl2d_prepared_destroy(prepared);
    const auto options=fixtures.get<Object>().at("serialize").get<picojson::array>().front().get<Object>().at("options").serialize();
    const auto saved=read([&](char* b,uint32_t c,uint32_t* n){return fl2d_session_document_json(large_session,reinterpret_cast<const uint8_t*>(options.data()),static_cast<uint32_t>(options.size()),b,c,n);}).get<Object>().at("value").serialize();
    const auto reopened=read([&](char* b,uint32_t c,uint32_t* n){return fl2d_document_parse_json(reinterpret_cast<const uint8_t*>(saved.data()),static_cast<uint32_t>(saved.size()),b,c,n);});
    assert(reopened.get<Object>().at("value").get<Object>().at("project").get<Object>().at("metadata")==large.get<Object>().at("metadata"));
    fl2d_session_destroy(large_session);
    uint32_t size=123;const uint8_t invalid[]={0xc0,0xaf};
    assert(fl2d_document_parse_json(invalid,2,nullptr,0,&size)==FL2D_INVALID_UTF8 && size==0);
    assert(fl2d_document_parse_json(invalid,FL2D_DOCUMENT_MAX_BYTES+1,nullptr,0,&size)==FL2D_INPUT_TOO_LARGE);
    // JSON permits only SP, TAB, LF and CR around its single root value.
    const auto document=fixtures.get<Object>().at("serialize").get<picojson::array>().front().get<Object>().at("expected").serialize();
    const auto parsed=read([&](char* b,uint32_t c,uint32_t* n){return fl2d_document_parse_json(reinterpret_cast<const uint8_t*>(document.data()),static_cast<uint32_t>(document.size()),b,c,n);});
    for(const std::string whitespace:{" ","\t","\n","\r","\r\n"," \t\r\n"}) {
        const auto padded=whitespace+document+whitespace;
        const auto actual=read([&](char* b,uint32_t c,uint32_t* n){return fl2d_document_parse_json(reinterpret_cast<const uint8_t*>(padded.data()),static_cast<uint32_t>(padded.size()),b,c,n);});
        assert(actual==parsed);
    }
    for(const std::string suffix:{"{}"," true","\nnull"," x","\v","\f","\xC2\xA0"}) {
        const auto trailing=document+suffix;size=123;
        assert(fl2d_document_parse_json(reinterpret_cast<const uint8_t*>(trailing.data()),static_cast<uint32_t>(trailing.size()),nullptr,0,&size)==FL2D_MALFORMED_JSON && size==0);
    }
    puts("Native document conformance passed.");
}
