extends Node2D
## Shows every .kfscene in this folder and plays its clips one after another.
## Press Space or click for the next clip.

var _rig: Node2D
var _player: AnimationPlayer
var _clips: PackedStringArray = []
var _index := 0
var _label := Label.new()
## How long the current clip has been showing. A looping clip never sends animation_finished,
## so it moves on after enough laps to read (at least one lap and MIN_SHOW seconds).
var _shown := 0.0
const MIN_SHOW := 3.0


func _ready() -> void:
	for file in DirAccess.get_files_at("res://demo"):
		var scene_path := "res://demo/%s" % file.trim_suffix(".import")
		if scene_path.ends_with(".kfscene") and _rig == null:
			var scene: PackedScene = load(scene_path)
			if scene:
				_rig = scene.instantiate()
				add_child(_rig)
	if _rig == null:
		_label.text = "No .kfscene in res://demo yet. Run: npm run godot -- <skeleton.json> --out integrations/godot/demo"
		add_child(_label)
		return
	_fit()
	_rig.keyframe_event.connect(func(event_name, _i, _f, _s): print("event: ", event_name))
	_player = _rig.get_node("AnimationPlayer")
	for clip in _player.get_animation_list():
		if clip != "RESET":
			_clips.append(clip)
	_label.position = Vector2(16, 16)
	add_child(_label)
	_player.animation_finished.connect(func(_name): _next())
	_play()


func _process(delta: float) -> void:
	if _player == null or _clips.is_empty():
		return
	_shown += delta
	var animation := _player.get_animation(_clips[_index])
	if animation and animation.loop_mode != Animation.LOOP_NONE and _shown >= maxf(MIN_SHOW, animation.length):
		_next()


func _unhandled_input(event: InputEvent) -> void:
	var pressed: bool = event is InputEventMouseButton and event.pressed
	pressed = pressed or (event is InputEventKey and event.pressed and event.keycode == KEY_SPACE)
	if pressed and _player:
		_next()


func _next() -> void:
	_index = (_index + 1) % max(_clips.size(), 1)
	_play()


func _play() -> void:
	if _clips.is_empty():
		return
	_shown = 0.0
	_player.play(_clips[_index])
	_label.text = "%s  (%d / %d, space for next)" % [_clips[_index], _index + 1, _clips.size()]


## Scale and place the rig so its setup pose fills most of the window, whatever its size.
func _fit() -> void:
	var box := Rect2()
	var first := true
	for node in _rig.find_children("*", "Polygon2D", true, false):
		var polygon := node as Polygon2D
		if not polygon.visible:
			continue
		var to_rig := _rig.get_global_transform().affine_inverse() * polygon.get_global_transform()
		for point in polygon.polygon:
			var p: Vector2 = to_rig * point
			if first:
				box = Rect2(p, Vector2.ZERO)
				first = false
			else:
				box = box.expand(p)
	var view := get_viewport_rect().size
	if first or box.size.x <= 0.0 or box.size.y <= 0.0:
		_rig.position = view * 0.5
		return
	var s := minf(view.x * 0.8 / box.size.x, view.y * 0.8 / box.size.y)
	_rig.scale = Vector2(s, s)
	_rig.position = view * 0.5 - box.get_center() * s
