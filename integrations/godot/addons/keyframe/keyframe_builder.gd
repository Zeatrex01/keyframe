@tool
extends RefCounted
## Builds a Godot scene from a Keyframe scene description (format "keyframe-godot").
##
## Skeleton2D / Bone2D for the bones, a Node2D per slot (colour, draw order) holding one
## Polygon2D per attachment, and an AnimationPlayer whose clips are Godot's own tracks: bezier
## tracks for keyed bone channels, value tracks for baked bones, colour, draw order, attachment
## visibility and deform, a method track for events. Usable at runtime too:
##   var rig = preload("res://addons/keyframe/keyframe_builder.gd").build(data, "res://hero")

const RIG_SCRIPT := preload("res://addons/keyframe/keyframe_rig.gd")


static func build(data: Dictionary, base_dir: String) -> Node2D:
	var root := Node2D.new()
	root.name = String(data.get("name", "Keyframe")).validate_node_name()
	root.set_script(RIG_SCRIPT)
	var skeleton := Skeleton2D.new()
	skeleton.name = "Skeleton"
	_adopt(root, root, skeleton)

	# Bones, parents first (the description lists them in that order).
	var bone_nodes := {}
	var bone_paths := {}
	for bone in data.get("bones", []):
		var node := Bone2D.new()
		node.name = _node_name(bone.name)
		var rest: Dictionary = bone.rest
		node.position = _vec(rest.position)
		node.rotation = rest.rotation
		node.scale = _vec(rest.scale)
		node.skew = rest.skew
		node.rest = node.transform
		node.set_autocalculate_length_and_angle(false)
		node.set_length(maxf(float(bone.get("length", 0.0)), 1.0))
		node.set_bone_angle(0.0)
		var parent: Node = skeleton if bone.parent == null else bone_nodes[bone.parent]
		_adopt(root, parent, node)
		bone_nodes[bone.name] = node
		bone_paths[bone.name] = String(skeleton.get_path_to(node))

	# Pages.
	var textures := {}
	var pma := {}
	for page in data.get("pages", []):
		var texture = ResourceLoader.load(base_dir.path_join(page.name))
		if texture == null:
			push_warning("Keyframe: the atlas page %s is missing beside the scene." % page.name)
		textures[page.name] = texture
		pma[page.name] = bool(page.get("pma", false))

	# Slots and attachments.
	var slot_paths := {}
	for slot in data.get("slots", []):
		var skinned := false
		for att in slot.attachments:
			skinned = skinned or att.type == "skinned"
		var node := Node2D.new()
		node.name = _node_name("%s (slot)" % slot.name)
		node.z_index = int(slot.z)
		node.z_as_relative = false
		node.modulate = _color(slot.color)
		# What the rig's set_attachment and set_look find the slot by.
		node.set_meta("keyframe_slot", String(slot.name))
		# "" for a slot drawn empty: Godot stores no meta for a null value.
		node.set_meta("keyframe_default", String(slot.attachment) if slot.attachment != null else "")
		# A skinned mesh is drawn in skeleton space, so its slot sits beside the skeleton.
		_adopt(root, root if skinned else bone_nodes[slot.bone], node)
		slot_paths[slot.name] = String(root.get_path_to(node))
		for att in slot.attachments:
			var polygon := Polygon2D.new()
			polygon.name = _node_name(att.name)
			polygon.texture = textures.get(att.page)
			polygon.polygon = _points(att.polygon)
			polygon.uv = _points(att.uv)
			polygon.color = _color(att.color)
			var triangles: Array = att.triangles
			var polygons := []
			for i in range(0, triangles.size(), 3):
				polygons.append(PackedInt32Array([triangles[i], triangles[i + 1], triangles[i + 2]]))
			polygon.polygons = polygons
			polygon.visible = att.name == slot.attachment
			var material := _material(String(slot.blend), pma.get(att.page, false))
			if material != null:
				polygon.material = material
			_adopt(root, node, polygon)
			if att.type == "skinned":
				polygon.skeleton = polygon.get_path_to(skeleton)
				for bone_name in att.weights:
					polygon.add_bone(NodePath(bone_paths[bone_name]), PackedFloat32Array(att.weights[bone_name]))

	# Animations.
	var player := AnimationPlayer.new()
	player.name = "AnimationPlayer"
	_adopt(root, root, player)
	var library := AnimationLibrary.new()
	var reset := Animation.new()
	reset.length = 0.001
	var reset_paths := {}
	for clip in data.get("animations", []):
		var animation := Animation.new()
		animation.length = maxf(float(clip.length), 0.001)
		animation.loop_mode = Animation.LOOP_LINEAR if clip.get("loop", false) else Animation.LOOP_NONE
		for track in clip.tracks:
			_add_track(animation, reset, reset_paths, track, data, bone_paths, slot_paths, root)
		library.add_animation(String(clip.name), animation)
	library.add_animation("RESET", reset)
	player.add_animation_library("", library)

	root.set_meta("keyframe_report", data.get("report", {}))
	var report: Dictionary = data.get("report", {})
	for line in report.get("baked", []):
		print("Keyframe: baked ", line)
	for line in report.get("skipped", []):
		print("Keyframe: not imported ", line)
	return root


static func _add_track(animation: Animation, reset: Animation, reset_paths: Dictionary, track: Dictionary, data: Dictionary,
		bone_paths: Dictionary, slot_paths: Dictionary, root: Node2D) -> void:
	var target := String(track.target)
	if target == "root":
		var index := animation.add_track(Animation.TYPE_METHOD)
		animation.track_set_path(index, NodePath("."))
		for key in track.keys:
			animation.track_insert_key(index, key.time, {"method": "_keyframe_event", "args": [key.name, int(key.int), float(key.float), String(key.string)]})
		return
	if target == "bone":
		var path := "Skeleton/%s:%s" % [bone_paths[track.name], track.property]
		var rest_value = _bone_rest(data, track.name, String(track.property))
		if track.type == "bezier":
			var index := animation.add_track(Animation.TYPE_BEZIER)
			animation.track_set_path(index, NodePath(path))
			for key in track.keys:
				animation.bezier_track_insert_key(index, key.time, key.value, _vec(key["in"]), _vec(key.out))
		else:
			var index := _value_track(animation, path, String(track.interpolation))
			for key in track.keys:
				var value = key.value
				if value is Array:
					value = _vec(value)
				animation.track_insert_key(index, key.time, value)
		_reset_key(reset, reset_paths, path, rest_value, track.type == "bezier")
		return
	if target == "slot":
		var slot_path := String(slot_paths[track.name])
		var slot := _slot(data, String(track.name))
		if track.property == "attachment":
			for att in slot.attachments:
				var path := "%s/%s:visible" % [slot_path, String(att.name).validate_node_name()]
				var index := _value_track(animation, path, "nearest")
				for key in track.keys:
					animation.track_insert_key(index, key.time, key.value == att.name)
				_reset_key(reset, reset_paths, path, att.name == slot.attachment, false)
		elif track.property == "modulate":
			var path := "%s:modulate" % slot_path
			var index := _value_track(animation, path, "linear")
			for key in track.keys:
				animation.track_insert_key(index, key.time, _color(key.value))
			_reset_key(reset, reset_paths, path, _color(slot.color), false)
		elif track.property == "z_index":
			var path := "%s:z_index" % slot_path
			var index := _value_track(animation, path, "nearest")
			for key in track.keys:
				animation.track_insert_key(index, key.time, int(key.value))
			_reset_key(reset, reset_paths, path, int(slot.z), false)
		return
	if target == "attachment":
		var path := "%s/%s:polygon" % [slot_paths[track.name], String(track.attachment).validate_node_name()]
		var index := _value_track(animation, path, "linear")
		for key in track.keys:
			animation.track_insert_key(index, key.time, _points(key.value))
		for att in _slot(data, String(track.name)).attachments:
			if att.name == track.attachment:
				_reset_key(reset, reset_paths, path, _points(att.polygon), false)


static func _value_track(animation: Animation, path: String, interpolation: String) -> int:
	var index := animation.add_track(Animation.TYPE_VALUE)
	animation.track_set_path(index, NodePath(path))
	if interpolation == "nearest":
		animation.track_set_interpolation_type(index, Animation.INTERPOLATION_NEAREST)
		animation.value_track_set_update_mode(index, Animation.UPDATE_DISCRETE)
	else:
		animation.track_set_interpolation_type(index, Animation.INTERPOLATION_LINEAR)
		animation.value_track_set_update_mode(index, Animation.UPDATE_CONTINUOUS)
	return index


## The RESET clip holds the rest value of everything a clip animates, so clips blend cleanly.
static func _reset_key(reset: Animation, seen: Dictionary, path: String, value, bezier: bool) -> void:
	if seen.has(path) or value == null:
		return
	seen[path] = true
	if bezier:
		var index := reset.add_track(Animation.TYPE_BEZIER)
		reset.track_set_path(index, NodePath(path))
		reset.bezier_track_insert_key(index, 0.0, float(value))
	else:
		var index := reset.add_track(Animation.TYPE_VALUE)
		reset.track_set_path(index, NodePath(path))
		reset.track_insert_key(index, 0.0, value)


static func _bone_rest(data: Dictionary, bone_name: String, property: String):
	for bone in data.get("bones", []):
		if bone.name != bone_name:
			continue
		var rest: Dictionary = bone.rest
		var parts := property.split(":")
		var value = rest.get(parts[0])
		if parts.size() == 2:
			return float(value[0 if parts[1] == "x" else 1])
		return _vec(value) if value is Array else value
	return null


static func _slot(data: Dictionary, slot_name: String) -> Dictionary:
	for slot in data.get("slots", []):
		if slot.name == slot_name:
			return slot
	return {}


static func _material(blend: String, premultiplied: bool) -> CanvasItemMaterial:
	var material := CanvasItemMaterial.new()
	match blend:
		"add":
			material.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		"mul":
			material.blend_mode = CanvasItemMaterial.BLEND_MODE_MUL
		_:
			if not premultiplied:
				return null
			material.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
	return material


static func _adopt(root: Node, parent: Node, child: Node) -> void:
	parent.add_child(child)
	child.owner = root


static func _node_name(text: String) -> String:
	return text.validate_node_name()


static func _vec(values) -> Vector2:
	return Vector2(float(values[0]), float(values[1]))


static func _color(values) -> Color:
	return Color(float(values[0]), float(values[1]), float(values[2]), float(values[3]))


static func _points(values) -> PackedVector2Array:
	var out := PackedVector2Array()
	for i in range(0, values.size(), 2):
		out.append(Vector2(float(values[i]), float(values[i + 1])))
	return out
