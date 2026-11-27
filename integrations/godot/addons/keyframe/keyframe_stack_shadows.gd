@tool
class_name KeyframeStackShadows
extends CanvasGroup
## Sun shadows for KeyframeStack piles. Each pile's slices are drawn again in one dark colour, each
## slid along the sun by its own height, so a shadow has the outline of what casts it (a tower's
## long thin shadow, a car's short one). Every shadow draws into this one group first, so where two
## overlap they merge into one even shadow instead of getting darker.
##
##   var shadows := KeyframeStackShadows.new()
##   add_child(shadows)          # before or after the piles: it finds the ones already there
##   KeyframeStackShadows.sun = Vector2(0.6, -0.4)
##
## Keep the group above the ground and below the piles (its z_index is -1 by default).

## World units a shadow moves along the ground per unit of height.
static var sun := Vector2(0.62, -0.42)

## The shadow colour; its alpha is how dark the shadows are.
@export var color: Color = Color(0.12, 0.09, 0.06, 0.3):
	set(value):
		color = value
		self_modulate = Color(1, 1, 1, color.a)
		for p in _pieces:
			p.queue_redraw()

## Draw every second slice of a tall pile (more than 24 slices): half the work, the same outline.
@export var thin_tall: bool = true

var _pieces: Array = []


func _ready() -> void:
	z_index = -1
	self_modulate = Color(1, 1, 1, color.a)
	if Engine.is_editor_hint():
		return
	KeyframeStack.shadow_sink = self
	for s in get_tree().get_nodes_in_group("keyframe_stacks"):
		if s.casts_shadow:
			add_stack(s)


func _exit_tree() -> void:
	if KeyframeStack.shadow_sink == self:
		KeyframeStack.shadow_sink = null


## Gives the pile a shadow (piles in the scene do this themselves).
func add_stack(s: KeyframeStack) -> void:
	for p in _pieces:
		if p.stack == s:
			return
	var p := _Piece.new()
	p.stack = s
	p.owner_group = self
	add_child(p)
	_pieces.append(p)
	p.follow()


func _process(_delta: float) -> void:
	for i in range(_pieces.size() - 1, -1, -1):
		var p: _Piece = _pieces[i]
		if not is_instance_valid(p.stack) or not p.stack.is_inside_tree():
			p.queue_free()
			_pieces.remove_at(i)
			continue
		p.follow()


class _Piece extends Node2D:
	var stack: KeyframeStack
	var owner_group: KeyframeStackShadows
	var _rot := INF
	var _scale := Vector2.INF
	var _sun := Vector2.INF
	var _strip: Texture2D

	func follow() -> void:
		var xf := stack.global_transform
		global_position = xf.origin
		visible = stack.is_visible_in_tree()
		var r := xf.get_rotation()
		if not is_equal_approx(r, _rot) or not stack.global_scale.is_equal_approx(_scale) or not KeyframeStackShadows.sun.is_equal_approx(_sun) or stack._strip != _strip:
			_rot = r
			_scale = stack.global_scale
			_sun = KeyframeStackShadows.sun
			_strip = stack._strip
			global_rotation = r
			scale = _scale
			queue_redraw()

	func _draw() -> void:
		var info := stack.slices_info()
		var strip: Texture2D = info["strip"]
		if strip == null:
			return
		var n: int = info["slices"]
		var cols: int = info["columns"]
		var size: Vector2 = info["size"]
		var sc: float = info["scale"]
		var k := 1.0 / sc
		var gs := Vector2(maxf(0.01, absf(scale.x)), maxf(0.01, absf(scale.y)))
		# the sun is in world units; turn it into this piece's frame
		var dir := KeyframeStackShadows.sun.rotated(-global_rotation) / gs
		var col := Color(owner_group.color.r, owner_group.color.g, owner_group.color.b, 1.0)
		var step := 2 if owner_group.thin_tall and n > 24 else 1
		var base := -(info["pivot"] as Vector2) * k
		var dsize := size * k
		for i in range(0, n, step):
			draw_texture_rect_region(strip, Rect2(base + dir * (float(i) / sc), dsize), Rect2(Vector2((i % cols) * size.x, (i / cols) * size.y), size), col)
