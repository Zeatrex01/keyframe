@tool
extends Node2D
## The root of an imported Keyframe rig. Animation events arrive as `keyframe_event`.
##
## A dressable rig (a character drawn with armour looks and weapons) changes at run time:
##   rig.look = "leather"                     # every piece that has a leather look wears it
##   rig.look = ""                            # back to the look it was drawn in, taken-off pieces too
##   rig.weapon = "weapon_spear"              # or "" to put it away
##   rig.set_attachment("helmet", "")         # take one piece off
## A clip that keys a slot (each stance keys its weapon) shows what the clip says while it plays.

## Emitted when a clip passes one of its events.
signal keyframe_event(event_name: String, int_value: int, float_value: float, string_value: String)

## The look the rig wears, set in the Inspector or from code: "leather" dresses every piece that
## has a leather look; empty is the look it was drawn in.
@export var look: String = "":
	set(value):
		look = value
		if is_node_ready():
			set_look(value)

## What the "weapon" slot shows: "weapon", "weapon_spear"... Set it empty to put the weapon away.
## In the Inspector, empty keeps the weapon the rig was drawn with. Stance and attack clips show
## their own weapon while they play; the run and the jump keep this one.
@export var weapon: String = "":
	set(value):
		weapon = value
		if is_node_ready():
			set_attachment(WEAPON_SLOT, value)

## The slot `weapon` drives; set_look leaves it alone.
const WEAPON_SLOT := "weapon"

var _slot_map := {}


func _ready() -> void:
	_index_slots()
	if look != "":
		set_look(look)
	if weapon != "":
		set_attachment(WEAPON_SLOT, weapon)


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


## Dresses the rig in one look: every slot with an attachment "<slot>_<look>" wears it, a piece
## that was taken off included. An empty look puts every such piece back in the attachment it was
## drawn with. The weapon slot is left to `weapon`.
func set_look(new_look: String) -> void:
	for slot_name in _slots():
		if slot_name == WEAPON_SLOT:
			continue
		var names := get_attachments(slot_name)
		# A rig imported by an older add-on may lack the meta: ask before reading, so Godot logs nothing.
		if not _slot_map[slot_name].has_meta("keyframe_default"):
			continue
		var drawn: String = _slot_map[slot_name].get_meta("keyframe_default")
		var has_looks := false
		for n in names:
			has_looks = has_looks or n.begins_with("%s_" % slot_name)
		if not has_looks:
			continue
		var wanted := "%s_%s" % [slot_name, new_look]
		if new_look != "" and names.has(wanted):
			set_attachment(slot_name, wanted)
		elif new_look == "" or not names.has(wanted):
			set_attachment(slot_name, String(drawn))


func _index_slots() -> void:
	_slot_map.clear()
	for node in find_children("*", "Node2D", true, false):
		if node.has_meta("keyframe_slot"):
			_slot_map[String(node.get_meta("keyframe_slot"))] = node


func _slots() -> Array:
	if _slot_map.is_empty():
		_index_slots()
	return _slot_map.keys()


func _slot_node(slot_name: String) -> Node2D:
	if _slot_map.is_empty():
		_index_slots()
	return _slot_map.get(slot_name)
