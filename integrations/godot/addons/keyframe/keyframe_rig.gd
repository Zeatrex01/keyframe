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
##
## An upper-body layer (a clip that keys only the arms and the head, such as "punch_upper") plays
## over the clip the AnimationPlayer is playing, so the legs keep running:
##   rig.play_layer("punch_upper")
##   rig.play_layer("wave", 0.2, 0.3)        # eases in over 0.2 s, and back out over its last 0.3 s
##   rig.play_layer("carry", 0.25)           # a looping layer plays until it is stopped:
##   rig.stop_layer(0.3)                     # eased back into the clip beneath over 0.3 s
##
## Changing clips without a pop: the old clip blends into the new one over `seconds`. A clip that
## is playing blends into a fresh start of itself (a second jab), through a twin "<clip>__again".
##   rig.crossfade("run", 0.2)
##
## Live physics (a scene exported with physics "live"): the bones a physics constraint drives (a
## scarf, a ponytail, a cape) lag behind the motion and spring back while the game runs, as the
## studio's engine plays them. They feel the clips and the game moving the rig itself (a jump, a
## run across the level), after both players have posed the rig each frame.
##   rig.live_physics = false               # the bones show the clips as keyed
##   rig.reset_physics()                    # after a teleport: the springs start again at rest
## With the AnimationPlayer's callback mode set to Manual, call rig.step_physics(delta) after
## advancing it.

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

## How long `crossfade` blends from one clip into the next when it is not told, in seconds; also
## how long `stop_layer` eases a layer off.
@export_range(0.0, 2.0, 0.01) var blend_time: float = 0.2

## Whether the springs of a scene exported with live physics move the bones. Off, the bones show
## the clips as keyed.
@export var live_physics: bool = true:
	set(value):
		live_physics = value
		if not value:
			reset_physics()

## The slot `weapon` drives; set_look leaves it alone.
const WEAPON_SLOT := "weapon"
## The meta of a clip listing its tracks that only hold the rest of what other clips animate
## (every clip keys everything, so none inherits the last clip's pose); layers play without them.
const FILL_META := "keyframe_fill"
## The twin a clip crossfades through into a fresh start of itself.
const AGAIN := "__again"
## Between a layer clip and the clip beneath in the name of the layer's copy of the clip beneath:
## "wave__over__run". The layer eases in from it and back out into it.
const UNDER := "__over__"
## The root's meta holding the live springs: per physics constraint, its bone and its numbers.
const PHYSICS_META := "keyframe_physics"

var _slot_map := {}
## Counts the layers played and stopped, so a fade that ends after the next one began leaves it be.
var _layer_serial := 0
## What the layer waits for, counted on its own clock, so a player advanced by hand, slowed or
## paused stays in step: "at" eases a one-shot layer off when its clip reaches that time; "fade"
## stops the layer once it has blended that long into the clip beneath. Empty for nothing.
var _layer_wait := {}
var _springs: Array[Spring] = []
var _origin := Vector2.ZERO
var _origin_known := false


func _ready() -> void:
	_index_slots()
	if look != "":
		set_look(look)
	if weapon != "":
		set_attachment(WEAPON_SLOT, weapon)
	_index_springs()


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


## Plays `clip` on a second player over the one running: its tracks (the arms and the head of an
## upper-body clip) win while it plays, and the rest of the rig follows the clip beneath. `seconds`
## eases it in from what the clip beneath shows (0 cuts in). A clip that plays once eases back out
## over its last `fade_out` seconds (0: the arms go back to the clip beneath when it ends); a looping
## clip plays until `stop_layer`. Returns false when the rig has no such clip.
func play_layer(clip: String, seconds: float = 0.0, fade_out: float = 0.0) -> bool:
	var base := get_node_or_null("AnimationPlayer") as AnimationPlayer
	if base == null or not base.has_animation(clip):
		return false
	var layer := get_node_or_null("LayerPlayer") as AnimationPlayer
	if layer == null:
		layer = AnimationPlayer.new()
		layer.name = "LayerPlayer"
		add_child(layer)                          # after the AnimationPlayer: its tracks are applied last
		layer.root_node = base.root_node
		layer.add_animation_library("", AnimationLibrary.new())
	# The layer's own copy of the clip, without the tracks that only hold the rest of the rig: the
	# legs stay with the clip beneath.
	var library := layer.get_animation_library("")
	if not library.has_animation(clip):
		var source := base.get_animation(clip)
		var own := source.duplicate() as Animation
		var fills: PackedInt32Array = source.get_meta(FILL_META, PackedInt32Array())
		for i in range(fills.size() - 1, -1, -1):
			own.remove_track(fills[i])
		if own.has_meta(FILL_META):
			own.remove_meta(FILL_META)
		library.add_animation(clip, own)
	layer.callback_mode_process = base.callback_mode_process   # a manual base stays manual
	_layer_serial += 1
	layer.stop()
	var under := _under(base, layer, clip) if seconds > 0.0 else ""
	if under != "":
		# Start on the clip beneath, where it is, and blend into the layer.
		layer.play(under, -1.0, _speed_under(base, layer))
		layer.seek(base.current_animation_position, true)
		layer.play(clip, seconds)
	else:
		layer.play(clip)
	var length := library.get_animation(clip).length
	_layer_wait = {}
	if fade_out > 0.0 and library.get_animation(clip).loop_mode == Animation.LOOP_NONE:
		_wait_on(layer, {"at": maxf(length - fade_out, 0.0), "seconds": minf(fade_out, length)})
	return true


## Eases the layer off over `seconds` (below 0 uses `blend_time`; 0 cuts it): its tracks blend back
## into what the clip beneath shows, then the layer stops. It ends a looping layer (a carry pose, a
## wave that repeats) or a one-shot one early. Returns false when no layer is playing.
func stop_layer(seconds: float = -1.0) -> bool:
	var base := get_node_or_null("AnimationPlayer") as AnimationPlayer
	var layer := get_node_or_null("LayerPlayer") as AnimationPlayer
	if base == null or layer == null or not layer.is_playing():
		return false
	var current := String(layer.current_animation)
	if current.contains(UNDER):
		return true                               # already easing off
	_layer_serial += 1
	_layer_wait = {}
	var fade := blend_time if seconds < 0.0 else seconds
	var speed := _speed_under(base, layer)
	var under := _under(base, layer, current) if fade > 0.0 and layer.speed_scale != 0.0 and absf(speed) > 0.0001 else ""
	if under == "":
		layer.stop()
		return true
	layer.play(under, fade, speed)
	layer.seek(base.current_animation_position)
	_wait_on(layer, {"fade": fade, "speed": speed, "beneath": String(base.current_animation)})
	return true


func _ease_off_layer(serial: int, seconds: float) -> void:
	if serial == _layer_serial:
		stop_layer(seconds)


func _end_layer(serial: int) -> void:
	var layer := get_node_or_null("LayerPlayer") as AnimationPlayer
	if serial == _layer_serial and layer != null:
		layer.stop()


## The layer's copy of the clip the AnimationPlayer is playing, on the tracks the layer clip keys:
## showing it is showing the clip beneath. "" when nothing plays beneath.
func _under(base: AnimationPlayer, layer: AnimationPlayer, clip: String) -> String:
	var beneath := String(base.current_animation)
	if not base.is_playing() or beneath == "":
		return ""
	var held := clip + UNDER + beneath
	var library := layer.get_animation_library("")
	if library.has_animation(held):
		return held
	var keyed := {}
	var own := library.get_animation(clip)
	for i in own.get_track_count():
		if own.track_get_type(i) != Animation.TYPE_METHOD:
			keyed[own.track_get_path(i)] = true
	var copy := base.get_animation(beneath).duplicate() as Animation
	for i in range(copy.get_track_count() - 1, -1, -1):
		# No events: the clip beneath fires its own.
		if copy.track_get_type(i) == Animation.TYPE_METHOD or not keyed.has(copy.track_get_path(i)):
			copy.remove_track(i)
	if copy.has_meta(FILL_META):
		copy.remove_meta(FILL_META)
	library.add_animation(held, copy)
	return held


## The custom speed that runs the layer's copy of the clip beneath at the speed the clip beneath runs.
func _speed_under(base: AnimationPlayer, layer: AnimationPlayer) -> float:
	return base.get_playing_speed() / layer.speed_scale if layer.speed_scale != 0.0 else 1.0


## Waits on the layer's own clock (see `_layer_wait`): the layer reports each time it has posed the
## rig, in whatever way it is advanced.
func _wait_on(layer: AnimationPlayer, wait: Dictionary) -> void:
	wait["serial"] = _layer_serial
	wait["animation"] = String(layer.current_animation)
	wait["last"] = layer.current_animation_position
	wait["done"] = 0.0
	_layer_wait = wait
	if not layer.mixer_applied.is_connected(_on_layer_applied):
		layer.mixer_applied.connect(_on_layer_applied)


func _on_layer_applied() -> void:
	var layer := get_node_or_null("LayerPlayer") as AnimationPlayer
	if layer == null or _layer_wait.is_empty():
		return
	var wait := _layer_wait
	if int(wait.serial) != _layer_serial or not layer.is_playing() or String(layer.current_animation) != String(wait.animation):
		_layer_wait = {}
		return
	var played := layer.current_animation_position
	if wait.has("at"):
		if played >= float(wait.at):
			_layer_wait = {}
			_ease_off_layer.call_deferred(_layer_serial, float(wait.seconds))
		return
	# Easing off: the copy of the clip beneath runs at `speed` times the player's clock, the clock
	# the blend runs on, so the time it has played says how far the blend has come.
	var speed := float(wait.speed)
	var step := played - float(wait.last)
	if step * speed < 0.0:
		step += layer.get_animation(layer.current_animation).length * signf(speed)   # it looped
	wait["last"] = played
	wait["done"] = float(wait.done) + absf(step / speed)
	var base := get_node_or_null("AnimationPlayer") as AnimationPlayer
	# Done, or the clip beneath changed (the copy would hold the old one): the layer stops.
	if float(wait.done) >= float(wait.fade) or base == null or String(base.current_animation) != String(wait.beneath):
		_layer_wait = {}
		_end_layer.call_deferred(_layer_serial)


## Plays `clip` on the AnimationPlayer, blending from what it played over `seconds` (Godot's own
## blend between clips; below 0 uses `blend_time`). Asked for the clip that is playing, it starts it
## again with a blend instead of snapping to its first frame: it plays the clip's twin
## "<clip>__again" (made the first time), and the clip again the time after. Returns false when the
## rig has no such clip.
func crossfade(clip: String, seconds: float = -1.0) -> bool:
	var base := get_node_or_null("AnimationPlayer") as AnimationPlayer
	if base == null or not base.has_animation(clip):
		return false
	var target := clip
	if base.is_playing() and base.current_animation == clip:
		target = clip + AGAIN
		if not base.has_animation(target):
			var source := base.get_animation(clip)
			var twin := source.duplicate() as Animation
			twin.set_meta(FILL_META, source.get_meta(FILL_META, PackedInt32Array()))
			base.get_animation_library("").add_animation(target, twin)
	base.play(target, blend_time if seconds < 0.0 else seconds)
	return true


## Moves the springs of live physics by `delta` seconds and poses their bones. The rig calls it every
## frame after both players (in their process step); call it yourself after advancing an
## AnimationPlayer whose callback mode is Manual.
func step_physics(delta: float) -> void:
	if _springs.is_empty() or not live_physics or delta <= 0.0:
		return
	var to_rig := global_transform.affine_inverse()
	# The game moving the rig moves every bone with it: in the rig's own axes, skeleton y up.
	var moved := Vector2.ZERO
	if _origin_known:
		moved = to_rig.basis_xform(global_position - _origin)
	_origin = global_position
	_origin_known = true
	for spring in _springs:
		spring.restore()
	for spring in _springs:
		spring.step(delta, Vector2(moved.x, -moved.y), to_rig)


## Puts the springs at rest where the bones are now (after a teleport, or a jump cut), and the bones
## back to what the clips show.
func reset_physics() -> void:
	for spring in _springs:
		spring.restore()
		spring.ready = false
	_origin_known = false


func _process(delta: float) -> void:
	if _callback_mode() == AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_IDLE:
		step_physics(delta)


func _physics_process(delta: float) -> void:
	if _callback_mode() == AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_PHYSICS:
		step_physics(delta)


func _callback_mode() -> int:
	var base := get_node_or_null("AnimationPlayer") as AnimationPlayer
	return base.callback_mode_process if base != null else AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_IDLE


func _index_springs() -> void:
	_springs.clear()
	if has_meta(PHYSICS_META):
		for entry in get_meta(PHYSICS_META):
			var bone := get_node_or_null(NodePath(String(entry.get("path", "")))) as Node2D
			if bone != null:
				_springs.append(Spring.new(entry, bone))
	# Springs run in the game, after the players (a higher priority runs later), never in the editor.
	var running := not _springs.is_empty() and not Engine.is_editor_hint()
	if running:
		process_priority = 1
		process_physics_priority = 1
	set_process(running)
	set_physics_process(running)


## One physics constraint, played live: the studio engine's spring (src/engine/constraints.js), in
## skeleton space (y up) and the rig's own axes. The bone's origin and tip carry an offset from where
## the clips put them: motion leaves it behind (inertia), a spring of `strength` pulls it back,
## `damping` (per 1/60 s) bleeds its speed, `mass` divides the forces, wind (+x) and gravity (-y)
## push, on fixed steps of `step_time`.
class Spring extends RefCounted:
	var node: Node2D
	var length: float
	var reference: float
	var x: float
	var y: float
	var rotate: float
	var scale_x: float
	var shear_x: float
	var limit: float
	var step_time: float
	var inertia: float
	var strength: float
	var damping: float
	var mass: float
	var wind: float
	var gravity: float
	var mix: float
	var ready := false
	var ox := 0.0
	var oy := 0.0
	var vx := 0.0
	var vy := 0.0
	var rot := 0.0
	var vr := 0.0
	var scl := 0.0
	var vs := 0.0
	var last_x := 0.0
	var last_y := 0.0
	var tip_x := 0.0
	var tip_y := 0.0
	var remaining := 0.0
	# The bone as the clips posed it, and as the spring left it. A property no clip wrote since still
	# holds the spring's value, and goes back to the clips' before the next step.
	var animated := PackedFloat64Array()
	var applied := PackedFloat64Array()

	func _init(entry: Dictionary, bone: Node2D) -> void:
		node = bone
		length = float(entry.get("length", 0.0))
		reference = maxf(float(entry.get("reference", 100.0)), 0.001)
		x = float(entry.get("x", 0.0))
		y = float(entry.get("y", 0.0))
		rotate = float(entry.get("rotate", 0.0))
		scale_x = float(entry.get("scaleX", 0.0))
		shear_x = float(entry.get("shearX", 0.0))
		limit = float(entry.get("limit", 5000.0))
		step_time = maxf(float(entry.get("step", 1.0 / 60.0)), 1.0 / 240.0)
		inertia = float(entry.get("inertia", 1.0))
		strength = float(entry.get("strength", 100.0))
		damping = float(entry.get("damping", 1.0))
		mass = maxf(float(entry.get("mass", 1.0)), 0.0001)
		wind = float(entry.get("wind", 0.0))
		gravity = float(entry.get("gravity", 0.0))
		mix = float(entry.get("mix", 1.0))

	static func _read(bone: Node2D) -> PackedFloat64Array:
		return PackedFloat64Array([bone.position.x, bone.position.y, bone.rotation, bone.scale.x, bone.scale.y, bone.skew])

	## Takes back what the spring wrote where no clip wrote since, and keeps the clips' pose.
	func restore() -> void:
		if applied.size() == 6:
			var now := _read(node)
			for i in 6:
				if is_equal_approx(now[i], applied[i]):
					now[i] = animated[i]
			node.position = Vector2(now[0], now[1])
			node.rotation = now[2]
			node.scale = Vector2(now[3], now[4])
			node.skew = now[5]
		animated = _read(node)
		applied = PackedFloat64Array()

	func step(delta: float, moved: Vector2, to_rig: Transform2D) -> void:
		# The bone in skeleton space: columns (a, c) and (b, d), origin (wx, wy).
		var t: Transform2D = to_rig * node.global_transform
		var bone := spring(delta, moved, t.x.x, -t.y.x, -t.x.y, t.y.y, t.origin.x, -t.origin.y)
		if bone.is_empty():
			return
		var world := Transform2D(Vector2(bone[0], -bone[2]), Vector2(-bone[1], bone[3]), Vector2(bone[4], -bone[5]))
		var parent := node.get_parent() as Node2D
		node.transform = world if parent == null else (to_rig * parent.global_transform).affine_inverse() * world
		applied = _read(node)

	## The spring's step on the bone the clips posed, in skeleton space: the bone where it shows
	## ([a, b, c, d, wx, wy]), or nothing when it shows the clips' pose. Plain numbers only, so the
	## studio's gate runs this very function against its engine.
	func spring(delta: float, moved: Vector2, a: float, b: float, c: float, d: float, wx: float, wy: float) -> PackedFloat64Array:
		if not ready:
			ready = true
			ox = 0.0; oy = 0.0; vx = 0.0; vy = 0.0; rot = 0.0; vr = 0.0; scl = 0.0; vs = 0.0; remaining = 0.0
			last_x = wx; last_y = wy
			tip_x = wx + a * length; tip_y = wy + c * length
			return PackedFloat64Array()
		last_x -= moved.x; last_y -= moved.y; tip_x -= moved.x; tip_y -= moved.y
		var turns := rotate != 0.0 or shear_x != 0.0
		var stretches := scale_x != 0.0
		var reach := limit * delta
		var moved_x := clampf(last_x - wx, -reach, reach)
		var moved_y := clampf(last_y - wy, -reach, reach)
		if x != 0.0:
			ox += moved_x * inertia
		if y != 0.0:
			oy += moved_y * inertia
		var size := length * Vector2(a, c).length()
		var angle := atan2(c, a)
		var at_x := wx + ox * mix * x
		var at_y := wy + oy * mix * y
		if size > 0.0001:
			if turns:
				var shown := angle + rot * (rotate + shear_x) * mix
				var lag := wrapf(atan2(tip_y - at_y, tip_x - at_x) - shown, -PI, PI)
				rot += clampf(lag, -PI / 2.0, PI / 2.0) * inertia
			if stretches:
				scl += (moved_x * cos(angle) + moved_y * sin(angle)) * inertia / size
		last_x = wx; last_y = wy
		remaining = minf(remaining + delta, 1.0)
		if remaining >= step_time:
			var damp := pow(damping, 60.0 * step_time)
			var m := step_time / mass
			var fx := wind * reference
			var fy := -gravity * reference
			while remaining >= step_time:
				remaining -= step_time
				if x != 0.0:
					vx += (fx - ox * strength) * m; ox += vx * step_time; vx *= damp
				if y != 0.0:
					vy += (fy - oy * strength) * m; oy += vy * step_time; vy *= damp
				if size > 0.0001 and (turns or stretches):
					var now := angle + rot * (rotate + shear_x) * mix
					var cs := cos(now)
					var sn := sin(now)
					if turns:
						vr += ((cs * fy - sn * fx) * size / reference / reference - rot * strength) * m; rot += vr * step_time; vr *= damp
					if stretches:
						vs += ((cs * fx + sn * fy) / reference / reference - scl * strength) * m; scl += vs * step_time; vs *= damp
		if not (mix > 0.0):
			tip_x = wx + a * length; tip_y = wy + c * length
			return PackedFloat64Array()
		wx += ox * mix * x
		wy += oy * mix * y
		if turns:
			# Rotate turns both columns, shear only the bone's own axis.
			var r := rot * mix * rotate
			var q := r + rot * mix * shear_x
			var a0 := a
			a = cos(q) * a0 - sin(q) * c; c = sin(q) * a0 + cos(q) * c
			var b0 := b
			b = cos(r) * b0 - sin(r) * d; d = sin(r) * b0 + cos(r) * d
		if stretches:
			var s := 1.0 + scl * mix * scale_x
			a *= s; c *= s
		tip_x = wx + a * length; tip_y = wy + c * length
		return PackedFloat64Array([a, b, c, d, wx, wy])
