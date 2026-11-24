@tool
extends Node2D
## The root of an imported Keyframe rig. Animation events arrive as `keyframe_event`.
##
## A dressable rig (a character drawn with armour looks and weapons) changes at run time:
##   rig.set_look("leather")                  # every piece that has a leather look wears it
##   rig.set_look("")                         # back to the look it was drawn in
##   rig.set_attachment("helmet", "")         # take the helmet off
##   rig.set_attachment("weapon", "weapon_spear")
## A clip that keys a slot (each stance keys its weapon) shows what the clip says while it plays.

## Emitted when a clip passes one of its events.
signal keyframe_event(event_name: String, int_value: int, float_value: float, string_value: String)


## Called by the AnimationPlayer's method track; connect to `keyframe_event` instead.
func _keyframe_event(event_name: String, int_value: int, float_value: float, string_value: String) -> void:
	keyframe_event.emit(event_name, int_value, float_value, string_value)


## Shows `attachment` in the slot, or nothing when it is empty. Returns false for an unknown slot
## or attachment.
func set_attachment(slot_name: String, attachment: String) -> bool:
	var slot := _slot_node(slot_name)
	if slot == null:
		return false
	if attachment != "" and not get_attachments(slot_name).has(attachment):
		return false
	for child in slot.get_children():
		if child is Polygon2D:
			child.visible = child.name == attachment.validate_node_name()
	return true


## The attachments a slot can show, by name.
func get_attachments(slot_name: String) -> PackedStringArray:
	var names := PackedStringArray()
	var slot := _slot_node(slot_name)
	if slot != null:
		for child in slot.get_children():
			if child is Polygon2D:
				names.append(String(child.name))
	return names


## Dresses the rig in one look: each slot with an attachment "<slot>_<look>" shows it, the others
## keep what they show. An empty look puts every such slot back in the attachment it was drawn with.
func set_look(look: String) -> void:
	for slot in _slots():
		var slot_name := String(slot.get_meta("keyframe_slot", ""))
		var default_attachment = slot.get_meta("keyframe_default", null)
		if look == "":
			if default_attachment != null and get_attachments(slot_name).has(String(default_attachment)) and _shown(slot) != "":
				set_attachment(slot_name, String(default_attachment))
		elif get_attachments(slot_name).has("%s_%s" % [slot_name, look]) and _shown(slot) != "":
			set_attachment(slot_name, "%s_%s" % [slot_name, look])


func _slots() -> Array:
	var out := []
	for node in find_children("*", "Node2D", true, false):
		if node.has_meta("keyframe_slot"):
			out.append(node)
	return out


func _slot_node(slot_name: String) -> Node2D:
	for node in _slots():
		if String(node.get_meta("keyframe_slot")) == slot_name:
			return node
	return null


func _shown(slot: Node2D) -> String:
	for child in slot.get_children():
		if child is Polygon2D and child.visible:
			return String(child.name)
	return ""
