// Keyframe-Studio-<version>-win-x64-setup.exe: the package zip with an installer around it. It
// unpacks the package into a temporary folder and runs its install.ps1 (per user, no admin
// rights): the app goes to %LOCALAPPDATA%\Programs\Keyframe Studio with Start menu and desktop
// shortcuts and an entry in Windows' app list to remove it. Built by tools/package-win.js.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Keyframe Studio Setup")]
[assembly: AssemblyProduct("Keyframe Studio")]

static class Setup
{
    [STAThread]
    static int Main()
    {
        const string Name = "Keyframe Studio";
        string tmp = Path.Combine(Path.GetTempPath(), "KeyframeStudioSetup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        try
        {
            Directory.CreateDirectory(tmp);
            using (Stream zip = Assembly.GetExecutingAssembly().GetManifestResourceStream("package.zip"))
            using (var archive = new ZipArchive(zip, ZipArchiveMode.Read))
                archive.ExtractToDirectory(tmp);
            string package = Path.Combine(tmp, Name);
            string current = File.ReadAllText(Path.Combine(package, "current")).Trim();
            string script = Path.Combine(package, current, "install", "install.ps1");
            var info = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Source \"" + package + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using (Process install = Process.Start(info))
            {
                install.WaitForExit();
                if (install.ExitCode != 0)
                {
                    MessageBox.Show("Keyframe Studio could not be installed (code " + install.ExitCode + "). You can also unzip the package and start Keyframe Studio.exe from it.", Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return install.ExitCode;
                }
            }
            return 0;
        }
        catch (Exception e)
        {
            MessageBox.Show("Keyframe Studio could not be installed: " + e.Message, Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try { Directory.Delete(tmp, true); } catch { }
        }
    }
}
