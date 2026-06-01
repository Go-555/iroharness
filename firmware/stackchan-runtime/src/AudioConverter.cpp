#include "AudioConverter.h"

namespace aiavatar {

namespace {
static constexpr int16_t kMuLawBias = 0x84;
static constexpr int16_t kMuLawClip = 32635;
}  // namespace

AudioFormat MuLawAudioConverter::encodedFormat(uint32_t pcmSampleRate, uint8_t pcmChannels) const {
    return {"mulaw", pcmSampleRate, pcmChannels, 8};
}

size_t MuLawAudioConverter::maxEncodedBytes(size_t pcmSamples, uint8_t) const {
    return pcmSamples;
}

size_t MuLawAudioConverter::maxDecodedSamples(size_t encodedBytes,
                                              const AudioFormat& encodedFormat) const {
    return encodedFormat.channels > 0 ? encodedBytes : 0;
}

bool MuLawAudioConverter::encode(const int16_t* pcm, size_t pcmSamples, uint8_t,
                                 uint8_t* out, size_t outCapacity, size_t& outLen) {
    outLen = 0;
    if (!pcm || !out || outCapacity < pcmSamples) return false;
    for (size_t i = 0; i < pcmSamples; ++i) {
        out[i] = encodeSample(pcm[i]);
    }
    outLen = pcmSamples;
    return true;
}

bool MuLawAudioConverter::decode(const uint8_t* data, size_t dataLen,
                                 const AudioFormat& encodedFormat,
                                 int16_t* outPcm, size_t outCapacitySamples,
                                 size_t& outSamples) {
    outSamples = 0;
    if (!data || !outPcm || encodedFormat.bitsPerSample != 8 || outCapacitySamples < dataLen) {
        return false;
    }
    for (size_t i = 0; i < dataLen; ++i) {
        outPcm[i] = decodeSample(data[i]);
    }
    outSamples = dataLen;
    return true;
}

uint8_t MuLawAudioConverter::encodeSample(int16_t sample) {
    uint8_t sign = 0;
    int16_t magnitude = sample;
    if (magnitude < 0) {
        magnitude = -magnitude;
        sign = 0x80;
    }
    if (magnitude > kMuLawClip) magnitude = kMuLawClip;
    magnitude += kMuLawBias;

    uint8_t exponent = 7;
    for (uint16_t mask = 0x4000; (magnitude & mask) == 0 && exponent > 0; mask >>= 1) {
        --exponent;
    }
    uint8_t mantissa = (magnitude >> (exponent + 3)) & 0x0F;
    return ~(sign | (exponent << 4) | mantissa);
}

int16_t MuLawAudioConverter::decodeSample(uint8_t code) {
    code = ~code;
    int16_t value = ((code & 0x0F) << 3) + kMuLawBias;
    value <<= (code & 0x70) >> 4;
    value -= kMuLawBias;
    return (code & 0x80) ? -value : value;
}

}  // namespace aiavatar
