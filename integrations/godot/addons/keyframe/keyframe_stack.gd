@tool
class_name KeyframeStack
extends Node2D
## A sprite stack exported by Keyframe Studio (export_art, kind "stack"): a top-down object (a car,
## a building, a tree) drawn as a pile of slices, each one above the last on the screen. The pile
## reads as a solid object at any angle.
##
##   var car := KeyframeStack.new()
##   car.map = "res://art/car-export/stack@2x.json"   # its strip, stack@2x.png, sits beside it
##   car.rotation = heading                           # turn it like any Node2D
##
## The node draws in rig units: a stack exported at 2x is pixel-exact under a Camera2D with zoom 2,
## one slice per screen pixel. The pile always rises up the screen, whatever the node's rotation
## and a turning Camera2D (ignore_rotation off), so the camera may follow a car's heading.
## With `sort_on_screen` the node keeps its z_index at its screen row, so piles overlap right while
## the camera turns; keep the ground below (z_index -1 or less).
##
## The 3D look, for every pile at once (all off by default):
##   KeyframeStack.shade = 0.34        # low slices darker, the top lighter (`shade_top`)
##   KeyframeStack.perspective = 0.0007 # piles lean away from the middle of the screen, a little
##                                       # more the further out they are, like a camera above them
## and a KeyframeStackShadows node in the scene draws every pile's sun shadow.

## The stack@<s>x.json export_art wrote; its strip PNG is read from the same folder.
@export_file("*.json") var map: String = "":
	set(value):
		map = value
		_load()

## How far apart the slices are on screen, in slices: 1 is as exported; more makes it taller.
@export var spacing: float = 1.0:
	set(value):
		spacing = value
		queue_redraw()

## Keep z_index at the node's row on the screen, for a turning camera.
@export var sort_on_screen: bool = true

## Multiplies the colour of every slice (a car's paint, a lit window at night).
@export var tint: Color = Color.WHITE:
	set(value):
		tint = value
		queue_redraw()

## Darken the low slices by this much (0 to 1) and lighten the top by `shade_top`, over
## `shade_height` rig units of height; 0 keeps the slices as drawn.
static var shade := 0.0
static var shade_top := 0.0
static var shade_height := 40.0
## How far a pile leans per rig unit it stands away from the middle of the screen (0 is off).
static var perspective := 0.0
## The point piles lean away from, in world units; INF follows the middle of the screen.
static var view_center := Vector2.INF
## Where piles report themselves for a sun shadow (the KeyframeStackShadows in the scene).
static var shadow_sink: Node = null

## Throw a sun shadow when a KeyframeStackShadows is in the scene.
@export var casts_shadow: bool = true

var _strip: Texture2D
var _slices := 0
var _columns := 1
var _size := Vector2.ZERO
var _pivot := Vector2.ZERO
var _scale := 1.0
var _view := 0.0
var _lean := Vector2.ZERO
var _src: Array[Rect2] = []
var _cols := PackedColorArray()
var _cache_key := []


func _ready() -> void:
	add_to_group("keyframe_stacks")
	if _strip == null and map != "":
		_load()
	if casts_shadow and is_instance_valid(shadow_sink) and not Engine.is_editor_hint():
		shadow_sink.add_stack(self)


## What a shadow needs to draw this pile again: its strip and how the slices sit in it.
func slices_info() -> Dictionary:
	return {"strip": _strip, "slices": _slices, "columns": _columns, "size": _size, "pivot": _pivot, "scale": _scale}


func _load() -> void:
	_strip = null
	_slices = 0
	if map == "" or not FileAccess.file_exists(map):
		queue_redraw()
		return
	var data = JSON.parse_string(FileAccess.get_file_as_string(map))
	if typeof(data) != TYPE_DICTIONARY or not data.has("meta"):
		push_warning("KeyframeStack: %s is not a stack map from Keyframe Studio." % map)
		return
	var meta: Dictionary = data["meta"]
	_slices = int(meta.get("slices", 0))
	# A long stack wraps into rows (a ferry or a tower would pass the texture size limit in one row).
	_columns = maxi(1, int(meta.get("columns", _slices)))
	_size = Vector2(float(meta["slice"]["w"]), float(meta["slice"]["h"]))
	_pivot = Vector2(float(meta["pivot"]["x"]), float(meta["pivot"]["y"]))
	_scale = maxf(0.01, float(meta.get("scale", 1.0)))
	var image_path: String = map.get_base_dir().path_join(String(meta.get("image", "")))
	if ResourceLoader.exists(image_path):
		_strip = load(image_path)
	else:
		var image := Image.load_from_file(image_path)
		if image != null:
			_strip = ImageTexture.create_from_image(image)
	queue_redraw()


func _process(_delta: float) -> void:
	if _strip == null:
		return
	var xf := get_global_transform_with_canvas()
	if sort_on_screen:
		z_index = clampi(int(xf.origin.y), RenderingServer.CANVAS_ITEM_Z_MIN + 1, RenderingServer.CANVAS_ITEM_Z_MAX)
	var view := xf.get_rotation()
	var lean := Vector2.ZERO
	if perspective > 0.0:
		# only piles on the screen follow the camera, so one off screen is not redrawn
		if get_viewport_rect().grow(200.0).has_point(xf.origin):
			var center := view_center
			if not center.is_finite():
				center = get_canvas_transform().affine_inverse() * (get_viewport_rect().size * 0.5)
			# steps of about a pixel at the top: a low pile barely moves and is seldom redrawn
			var q := clampf(float(_slices) * spacing / _scale, 4.0, 64.0)
			lean = ((global_position - center) * perspective * q).round() / q
		else:
			lean = _lean
	if not is_equal_approx(view, _view) or not lean.is_equal_approx(_lean):
		_view = view
		_lean = lean
		queue_redraw()


func _draw() -> void:
	if _strip == null or _slices <= 0:
		return
	# One slice up the screen, in this node's own (turned) frame, in rig units.
	var up := Vector2(0.0, -spacing / _scale).rotated(-_view)
	# the lean: world units sideways per slice, turned into this node's frame
	if _lean != Vector2.ZERO:
		var gs := global_scale
		up += (_lean * spacing / _scale).rotated(-global_rotation) / Vector2(maxf(0.01, absf(gs.x)), maxf(0.01, absf(gs.y)))
	var k := 1.0 / _scale
	_cache_slices()
	var base := -_pivot * k
	var dsize := _size * k
	for i in _slices:
		draw_texture_rect_region(_strip, Rect2(base + up * i, dsize), _src[i], _cols[i])


## Source rects and shaded colours per slice, kept until the strip, tint or shade changes, so a
## redraw (the camera panning with perspective on) is only the draw calls.
func _cache_slices() -> void:
	var key := [_strip, _slices, _columns, _size, tint, shade, shade_top, shade_height, _scale]
	if key == _cache_key:
		return
	_cache_key = key
	_src.resize(_slices)
	_cols.resize(_slices)
	var shaded := shade > 0.0 or shade_top > 0.0
	for i in _slices:
		_src[i] = Rect2(Vector2((i % _columns) * _size.x, (i / _columns) * _size.y), _size)
		var c := tint
		if shaded:
			var h: float = clampf(float(i) / _scale / shade_height, 0.0, 1.0)
			var f: float = lerpf(1.0 - shade, 1.0 + shade_top, pow(h, 0.6))
			if i == _slices - 1:
				f += shade_top * 0.5
			c = Color(tint.r * f, tint.g * f, tint.b * f, tint.a)
		_cols[i] = c
