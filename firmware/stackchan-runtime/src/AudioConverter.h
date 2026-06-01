#pragma once

#include <cstddef>
#include <cstdint>

namespace aiavatar {

struct AudioFormat {
    const char* codec;
    uint32_t sampleRate;
    uint8_t channels;
    uint8_t bitsPerSample;
};

class AudioConverter {
public:
    virtual ~AudioConverter() = default;

    virtual AudioFormat encodedFormat(uint32_t pcmSampleRate, uint8_t pcmChannels) const = 0;
    virtual size_t maxEncodedBytes(size_t pcmSamples, uint8_t pcmChannels) const = 0;
    virtual size_t maxDecodedSamples(size_t encodedBytes, const AudioFormat& encodedFormat) const = 0;

    virtual bool encode(const int16_t* pcm, size_t pcmSamples, uint8_t pcmChannels,
                        uint8_t* out, size_t outCapacity, size_t& outLen) = 0;
    virtual bool decode(const uint8_t* data, size_t dataLen, const AudioFormat& encodedFormat,
                        int16_t* outPcm, size_t outCapacitySamples, size_t& outSamples) = 0;
};

class MuLawAudioConverter : public AudioConverter {
public:
    AudioFormat encodedFormat(uint32_t pcmSampleRate, uint8_t pcmChannels) const override;
    size_t maxEncodedBytes(size_t pcmSamples, uint8_t pcmChannels) const override;
    size_t maxDecodedSamples(size_t encodedBytes, const AudioFormat& encodedFormat) const override;
    bool encode(const int16_t* pcm, size_t pcmSamples, uint8_t pcmChannels,
                uint8_t* out, size_t outCapacity, size_t& outLen) override;
    bool decode(const uint8_t* data, size_t dataLen, const AudioFormat& encodedFormat,
                int16_t* outPcm, size_t outCapacitySamples, size_t& outSamples) override;

private:
    static uint8_t encodeSample(int16_t sample);
    static int16_t decodeSample(uint8_t code);
};

}  // namespace aiavatar
