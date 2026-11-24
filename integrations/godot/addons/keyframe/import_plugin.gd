@tool
extends EditorImportPlugin
## Imports a Keyframe scene description (.kfscene, written by Keyframe Studio's
## `export_godot` tool or `npm run godot`) as a PackedScene.

const Builder := preload("res://addons/keyframe/keyframe_builder.gd")


func _get_importer_name() -> String:
	return "keyframe.scene"


func _get_visible_name() -> String:
	return "Keyframe scene"


func _get_recognized_extensions() -> PackedStringArray:
	return PackedStringArray(["kfscene"])


func _get_save_extension() -> String:
	return "scn"


func _get_resource_type() -> String:
	return "PackedScene"


func _get_priority() -> float:
	return 1.0


func _get_import_order() -> int:
	# After textures, so the atlas pages beside the file are already imported.
	return 100


func _get_preset_count() -> int:
	return 1


func _get_preset_name(_preset_index: int) -> String:
	return "Default"


func _get_import_options(_path: String, _preset_index: int) -> Array[Dictionary]:
	return []


func _get_option_visibility(_path: String, _option_name: StringName, _options: Dictionary) -> bool:
	return true


func _import(source_file: String, save_path: String, _options: Dictionary, _platform_variants: Array[String], _gen_files: Array[String]) -> Error:
	var text := FileAccess.get_file_as_string(source_file)
	if text.is_empty():
		push_error("Keyframe: cannot read %s" % source_file)
		return ERR_FILE_CANT_READ
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY or data.get("format", "") != "keyframe-godot":
		push_error("Keyframe: %s is not a Keyframe scene description." % source_file)
		return ERR_PARSE_ERROR
	var root: Node2D = Builder.build(data, source_file.get_base_dir())
	if root == null:
		return ERR_INVALID_DATA
	var scene := PackedScene.new()
	var packed := scene.pack(root)
	root.free()
	if packed != OK:
		return packed
	return ResourceSaver.save(scene, "%s.%s" % [save_path, _get_save_extension()])
