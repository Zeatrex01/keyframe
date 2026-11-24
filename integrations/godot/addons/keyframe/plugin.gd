@tool
extends EditorPlugin
## Registers the .kfscene importer.

var _importer: EditorImportPlugin


func _enter_tree() -> void:
	_importer = preload("res://addons/keyframe/import_plugin.gd").new()
	add_import_plugin(_importer)


func _exit_tree() -> void:
	remove_import_plugin(_importer)
	_importer = null
