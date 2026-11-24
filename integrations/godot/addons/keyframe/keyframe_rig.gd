@tool
extends Node2D
## The root of an imported Keyframe rig. Animation events arrive as `keyframe_event`.

## Emitted when a clip passes one of its events.
signal keyframe_event(event_name: String, int_value: int, float_value: float, string_value: String)


## Called by the AnimationPlayer's method track; connect to `keyframe_event` instead.
func _keyframe_event(event_name: String, int_value: int, float_value: float, string_value: String) -> void:
	keyframe_event.emit(event_name, int_value, float_value, string_value)
