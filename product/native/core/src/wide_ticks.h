#pragma once
#include <array>
#include <cstdint>
#include <stdexcept>
#include <utility>

namespace fl2d_ticks {
constexpr uint64_t max_safe = 9007199254740991ULL;
// Safe tick/rate products need up to 123 bits. Four 32-bit limbs keep the
// calculation identical on MSVC/GCC without long double or compiler extensions.
struct UInt128 {
    std::array<uint32_t,4> words{};
    explicit UInt128(uint64_t value = 0) : words{static_cast<uint32_t>(value),static_cast<uint32_t>(value >> 32),0,0} {}
    bool zero() const { return words == std::array<uint32_t,4>{}; }
    bool safe() const { return !words[3] && !words[2] && low() <= max_safe; }
    uint64_t low() const { return static_cast<uint64_t>(words[0]) | (static_cast<uint64_t>(words[1]) << 32); }
    int compare(const UInt128& other) const {
        for (size_t i = 4; i > 0; --i) if (words[i-1] != other.words[i-1]) return words[i-1] < other.words[i-1] ? -1 : 1;
        return 0;
    }
    UInt128 plus(const UInt128& other) const {
        UInt128 result; uint64_t carry = 0;
        for (size_t i = 0; i < 4; ++i) {
            const uint64_t sum = static_cast<uint64_t>(words[i])+other.words[i]+carry;
            result.words[i] = static_cast<uint32_t>(sum); carry = sum >> 32;
        }
        if (carry) throw std::overflow_error("Tick product exceeds 128 bits.");
        return result;
    }
    UInt128 minus(const UInt128& other) const {
        if (compare(other) < 0) throw std::underflow_error("Negative tick ratio.");
        UInt128 result; uint64_t borrow = 0;
        for (size_t i = 0; i < 4; ++i) {
            const uint64_t right = static_cast<uint64_t>(other.words[i])+borrow;
            result.words[i] = static_cast<uint32_t>(static_cast<uint64_t>(words[i])-right);
            borrow = static_cast<uint64_t>(words[i]) < right ? 1 : 0;
        }
        return result;
    }
    UInt128 times(uint64_t factor) const {
        const uint32_t parts[] = {static_cast<uint32_t>(factor),static_cast<uint32_t>(factor >> 32)};
        std::array<uint32_t,6> full{};
        for (size_t i = 0; i < 4; ++i) {
            uint64_t carry = 0;
            for (size_t j = 0; j < 2; ++j) {
                const uint64_t product = static_cast<uint64_t>(words[i])*parts[j]+full[i+j]+carry;
                full[i+j] = static_cast<uint32_t>(product); carry = product >> 32;
            }
            full[i+2] = static_cast<uint32_t>(carry);
        }
        if (full[4] || full[5]) throw std::overflow_error("Tick product exceeds 128 bits.");
        UInt128 result;
        for (size_t i = 0; i < 4; ++i) result.words[i] = full[i];
        return result;
    }
    std::pair<UInt128,UInt128> divmod(const UInt128& divisor) const {
        if (divisor.zero()) throw std::invalid_argument("Zero tick divisor.");
        UInt128 quotient, remainder;
        for (size_t bit = 128; bit > 0; --bit) {
            remainder = remainder.times(2);
            if ((words[(bit-1)/32] >> ((bit-1)%32)) & 1) remainder = remainder.plus(UInt128(1));
            if (remainder.compare(divisor) >= 0) {
                remainder = remainder.minus(divisor);
                quotient.words[(bit-1)/32] |= uint32_t{1} << ((bit-1)%32);
            }
        }
        return {quotient,remainder};
    }
};
inline UInt128 round_half_up(const UInt128& numerator, uint64_t denominator) {
    const auto divided = numerator.divmod(UInt128(denominator));
    return divided.second.times(2).compare(UInt128(denominator)) >= 0 ? divided.first.plus(UInt128(1)) : divided.first;
}
inline UInt128 local_tick(uint64_t elapsed, uint64_t offset, uint64_t n, uint64_t d) {
    return round_half_up(UInt128(offset).times(d).plus(UInt128(elapsed).times(n)),d);
}
}
