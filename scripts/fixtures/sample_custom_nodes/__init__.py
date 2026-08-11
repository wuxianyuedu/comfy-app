# Sample ComfyUI custom node package (TEST FIXTURE ONLY).
# Mirrors the "Set FPS" style node from the product screenshot.
# This file exists only to validate the read-only AST parser; it is NOT part of
# the configured CUSTOM_NODES_PATH and is never modified by the parser.

class Set_FPS:
    """Set the frames-per-second of a video/image sequence."""

    OUTPUT_NODE = False
    CATEGORY = "video"
    FUNCTION = "set_fps"
    DESCRIPTION = "Set the playback frame rate of a media sequence."

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "frame_rate": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 120.0}),
                "codec": (["video/mp4", "video/webm", "image/gif"], {"default": "video/mp4"}),
                "image": ("IMAGE",),
            },
            "optional": {
                "audio": ("AUDIO",),
                "loop": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)

    def set_fps(self, frame_rate, codec, image, audio=None, loop=False):
        return (image,)


class VideoCombine:
    """Combine frames into a video file (frontend preview node)."""

    OUTPUT_NODE = True
    CATEGORY = "video/combine"
    FUNCTION = "combine"
    DESCRIPTION = "Combine an image sequence into a playable video."

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "fps": ("INT", {"default": 24, "min": 1, "max": 240}),
                "format": (["mp4", "webm", "gif"], {"default": "mp4"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("video_path",)

    def combine(self, images, fps, format):
        return ("",)


# ComfyUI registration
NODE_CLASS_MAPPINGS = {
    "Set_FPS": Set_FPS,
    "VideoCombine": VideoCombine,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Set_FPS": "Set FPS",
    "VideoCombine": "Video Combine",
}
