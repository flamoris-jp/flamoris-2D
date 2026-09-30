#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace fl2d_text {
// ECMAScript relational/default-sort semantics compare UTF-16 code units.
// Interchange strings have already passed the shared UTF-8/JSON syntax gate.
inline std::vector<uint16_t> utf16(const std::string& text) {
    std::vector<uint16_t> result;
    for (size_t pos = 0; pos < text.size();) {
        auto lead = static_cast<unsigned char>(text[pos++]);
        uint32_t cp = lead;
        if (lead >= 0x80) {
            const int count = lead < 0xE0 ? 1 : lead < 0xF0 ? 2 : 3;
            cp = lead < 0xE0 ? lead & 0x1F : lead < 0xF0 ? lead & 0x0F : lead & 0x07;
            for (int i = 0; i < count; ++i) cp = (cp << 6) | (static_cast<unsigned char>(text[pos++]) & 0x3F);
        }
        if (cp <= 0xFFFF) result.push_back(static_cast<uint16_t>(cp));
        else { cp -= 0x10000; result.push_back(static_cast<uint16_t>(0xD800 + (cp >> 10))); result.push_back(static_cast<uint16_t>(0xDC00 + (cp & 1023))); }
    }
    return result;
}
inline bool less(const std::string& a, const std::string& b) { return utf16(a) < utf16(b); }
}
