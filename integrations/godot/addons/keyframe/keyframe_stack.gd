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

var _strip: Texture2D
var _slices := 0
var _columns := 1
var _size := Vector2.ZERO
var _pivot := Vector2.ZERO
var _scale := 1.0
var _view := 0.0


func _ready() -> void:
	if _strip == null and map != "":
		_load()


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
	if not is_equal_approx(view, _view):
		_view = view
		queue_redraw()


func _draw() -> void:
	if _strip == null or _slices <= 0:
		return
	# One slice up the screen, in this node's own (turned) frame, in rig units.
	var up := Vector2(0.0, -spacing / _scale).rotated(-_view)
	var k := 1.0 / _scale
	for i in _slices:
		draw_set_transform(up * i, 0.0, Vector2(k, k))
		draw_texture_rect_region(_strip, Rect2(-_pivot, _size), Rect2(Vector2((i % _columns) * _size.x, (i / _columns) * _size.y), _size), tint)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
