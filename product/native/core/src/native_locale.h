#pragma once
#include <unicode/ucol.h>
#include <unicode/uloc.h>
#include <unicode/ustring.h>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace fl2d_locale {
inline void checked(UErrorCode status) {
    if (U_FAILURE(status)) throw std::runtime_error(u_errorName(status));
}
inline std::string default_locale() {
    const std::string locale(uloc_getDefault());
    // V8 uses en-US for the POSIX/C default instead of POSIX collation.
    return locale == "en_US_POSIX" || locale == "c" ? "en_US" : locale;
}
inline std::vector<UChar> utf16(const std::string& text) {
    UErrorCode status = U_ZERO_ERROR; int32_t length = 0;
    u_strFromUTF8(nullptr,0,&length,text.data(),static_cast<int32_t>(text.size()),&status);
    if (status != U_BUFFER_OVERFLOW_ERROR) checked(status);
    std::vector<UChar> result(static_cast<size_t>(length)+1); status = U_ZERO_ERROR;
    u_strFromUTF8(result.data(),length+1,nullptr,text.data(),static_cast<int32_t>(text.size()),&status);
    checked(status); result.resize(static_cast<size_t>(length)); return result;
}
class Collator {
    std::unique_ptr<UCollator,decltype(&ucol_close)> value_{nullptr,ucol_close};
public:
    Collator() {
        UErrorCode status = U_ZERO_ERROR;
        value_.reset(ucol_open(default_locale().c_str(),&status)); checked(status);
        ucol_setAttribute(value_.get(),UCOL_NORMALIZATION_MODE,UCOL_ON,&status);
        ucol_setStrength(value_.get(),UCOL_TERTIARY); checked(status);
    }
    bool less(const std::string& left, const std::string& right) const {
        const auto a = utf16(left), b = utf16(right);
        return ucol_strcoll(value_.get(),a.data(),static_cast<int32_t>(a.size()),
            b.data(),static_cast<int32_t>(b.size())) == UCOL_LESS;
    }
};
inline std::vector<UChar> lower(const std::string& text) {
    const auto source = utf16(text); const auto locale = default_locale();
    UErrorCode status = U_ZERO_ERROR;
    const auto length = u_strToLower(nullptr,0,source.data(),static_cast<int32_t>(source.size()),locale.c_str(),&status);
    if (status != U_BUFFER_OVERFLOW_ERROR) checked(status);
    std::vector<UChar> result(static_cast<size_t>(length)+1); status = U_ZERO_ERROR;
    u_strToLower(result.data(),length+1,source.data(),static_cast<int32_t>(source.size()),locale.c_str(),&status);
    checked(status); result.resize(static_cast<size_t>(length)); return result;
}
}
