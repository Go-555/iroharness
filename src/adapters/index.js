export const createMotionPngTuberMapper = () =>
  Object.freeze({
    id: "motionpngtuber-mapper",
    mapState(state) {
      if (state.mode === "speaking") {
        return "mouth_on_eye_on";
      }
      if (state.mode === "working" || state.mode === "thinking") {
        return "mouth_off_eye_on";
      }
      if (state.mode === "error") {
        return "mouth_off_eye_off";
      }
      return "mouth_off_eye_on";
    }
  });

export const createM5StackFaceMapper = () =>
  Object.freeze({
    id: "m5stack-face-mapper",
    mapState(state) {
      const faces = {
        idle: ":)",
        listening: "o_o",
        thinking: "...",
        speaking: ":D",
        working: ">_>",
        error: "x_x"
      };
      return faces[state.mode] || faces.idle;
    }
  });

export const createEvenG2DisplayMapper = () =>
  Object.freeze({
    id: "even-g2-display-mapper",
    mapState(state) {
      if (state.speechText) {
        return state.speechText.slice(0, 80);
      }
      if (state.mode === "working") {
        return "Working...";
      }
      if (state.mode === "thinking") {
        return "Thinking...";
      }
      return "";
    }
  });
