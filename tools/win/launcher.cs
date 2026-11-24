// Keyframe Studio.exe: starts the studio of the version named in `current` with the bundled Node,
// without a console window. Built by tools/package-win.js with the C# compiler every Windows has.
//
// If that version fails right away and the version it replaced (`previous`) is still there, the
// launcher goes back to it, so a broken update never leaves the owner without a studio.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Keyframe Studio")]
[assembly: AssemblyProduct("Keyframe Studio")]
[assembly: AssemblyDescription("Keyframe Studio launcher")]

static class Launcher
{
    const string Name = "Keyframe Studio";

    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string current = ReadName(Path.Combine(root, "current"));
        string previous = ReadName(Path.Combine(root, "previous"));
        if (!Startable(root, current))
        {
            string other = new[] { previous }
                .Concat(Directory.GetDirectories(root, "app-*").Select(Path.GetFileName).OrderByDescending(n => n, StringComparer.Ordinal))
                .FirstOrDefault(n => Startable(root, n));
            if (other == null) { Fail("No complete version of Keyframe Studio is in " + root + ". Download the package again."); return 2; }
            current = other;
            WriteName(Path.Combine(root, "current"), current);
        }
        for (int attempt = 0; attempt < 2; attempt++)
        {
            Process studio;
            try { studio = Start(root, current, args); }
            catch (Exception e) { Fail("Keyframe Studio could not start: " + e.Message); return 3; }
            // A studio that is still running after a while started fine; the launcher's job is done.
            if (!studio.WaitForExit(20000)) return 0;
            if (studio.ExitCode == 0) return 0;
            if (attempt == 0 && previous != null && previous != current && Startable(root, previous))
            {
                WriteName(Path.Combine(root, "current"), previous);
                MessageBox.Show(current.Replace("app-", "") + " did not start, so Keyframe Studio went back to " + previous.Replace("app-", "") + ".", Name, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                current = previous;
                continue;
            }
            Fail("Keyframe Studio stopped while starting. The log is in " + LogPath() + ".");
            return studio.ExitCode;
        }
        return 0;
    }

    static Process Start(string root, string folder, string[] args)
    {
        string dir = Path.Combine(root, folder);
        string arguments = Quote(Path.Combine(dir, "studio", "tools", "studio.js")) + " --app";
        // A folder dropped on the app (or passed by a shortcut) opens as the project.
        if (args.Length > 0 && Directory.Exists(args[0])) arguments += " --project " + Quote(Path.GetFullPath(args[0]));
        var info = new ProcessStartInfo(Path.Combine(dir, "node", "node.exe"), arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = dir,
        };
        info.EnvironmentVariables["KS_PACKAGED"] = "1";
        return Process.Start(info);
    }

    static bool Startable(string root, string folder)
    {
        if (string.IsNullOrEmpty(folder) || folder.IndexOfAny(new[] { '\\', '/', ':' }) >= 0) return false;
        string dir = Path.Combine(root, folder);
        return File.Exists(Path.Combine(dir, "node", "node.exe")) && File.Exists(Path.Combine(dir, "studio", "tools", "studio.js"));
    }

    static string ReadName(string file)
    {
        try { string text = File.ReadAllText(file).Trim(); return text.Length > 0 ? text : null; } catch { return null; }
    }

    static void WriteName(string file, string name)
    {
        try { string tmp = file + ".tmp"; File.WriteAllText(tmp, name + "\r\n"); if (File.Exists(file)) File.Delete(file); File.Move(tmp, file); } catch { }
    }

    static string Quote(string arg)
    {
        return "\"" + (arg.EndsWith("\\") ? arg + "\\" : arg) + "\"";
    }

    static string LogPath()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Name, "logs", "studio.log");
    }

    static void Fail(string message)
    {
        MessageBox.Show(message, Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
