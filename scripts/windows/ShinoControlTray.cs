using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using System.Runtime.InteropServices;

internal static class ShinoControlTray
{
    private static NotifyIcon tray;
    private static ToolStripMenuItem statusItem;
    private static ToolStripMenuItem supervisorItem;
    private static System.Windows.Forms.Timer timer;
    private static string runtimeRoot;
    private static string configPath;
    private static string startupLog;
    private static string healthUrl;
    private static int port = 4177;
    private static bool lastHealthy = false;
    private static Mutex mutex;

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool DestroyIcon(IntPtr handle);

    [STAThread]
    private static void Main()
    {
        bool created;
        mutex = new Mutex(true, "Local\\SHINO_CONTROL_TRAY", out created);
        if (!created) return;

        runtimeRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SHINO-Control");
        configPath = Path.Combine(runtimeRoot, "startup.json");
        startupLog = Path.Combine(runtimeRoot, "startup.log");
        LoadConfig();

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        tray = new NotifyIcon();
        tray.Icon = CreateControlIcon();
        tray.Text = "SHINO // CONTROL";
        tray.Visible = true;

        ContextMenuStrip menu = new ContextMenuStrip();
        statusItem = new ToolStripMenuItem("Core: checking...");
        statusItem.Enabled = false;
        statusItem.Font = new Font(statusItem.Font, FontStyle.Bold);
        menu.Items.Add(statusItem);

        supervisorItem = new ToolStripMenuItem("Supervisor: checking...");
        supervisorItem.Enabled = false;
        menu.Items.Add(supervisorItem);
        menu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem open = new ToolStripMenuItem("Open SHINO // CONTROL");
        open.Click += delegate { OpenUrl(); };
        menu.Items.Add(open);

        ToolStripMenuItem refresh = new ToolStripMenuItem("Refresh status");
        refresh.Click += delegate { RefreshStatus(true); };
        menu.Items.Add(refresh);

        ToolStripMenuItem restart = new ToolStripMenuItem("Restart CONTROL Core");
        restart.Click += delegate { RestartCore(); };
        menu.Items.Add(restart);

        menu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem logs = new ToolStripMenuItem("Open runtime folder");
        logs.Click += delegate { OpenRuntimeFolder(); };
        menu.Items.Add(logs);

        ToolStripMenuItem logFile = new ToolStripMenuItem("Open startup.log");
        logFile.Click += delegate { OpenStartupLog(); };
        menu.Items.Add(logFile);

        menu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem quit = new ToolStripMenuItem("Quit tray icon");
        quit.Click += delegate { QuitTray(); };
        menu.Items.Add(quit);

        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { OpenUrl(); };

        timer = new System.Windows.Forms.Timer();
        timer.Interval = 10000;
        timer.Tick += delegate { RefreshStatus(false); };
        timer.Start();

        RefreshStatus(false);
        Application.Run();

        tray.Visible = false;
        tray.Dispose();
        mutex.ReleaseMutex();
        mutex.Dispose();
    }

    private static void LoadConfig()
    {
        try
        {
            if (!File.Exists(configPath)) return;
            string json = File.ReadAllText(configPath);
            Match m = Regex.Match(json, "\\\"port\\\"\\s*:\\s*(\\d+)", RegexOptions.IgnoreCase);
            if (m.Success)
            {
                int parsed;
                if (Int32.TryParse(m.Groups[1].Value, out parsed)) port = parsed;
            }
        }
        catch { }
        healthUrl = "http://127.0.0.1:" + port + "/api/state";
    }

    private static bool IsCoreHealthy()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(healthUrl);
            request.Method = "GET";
            request.Timeout = 1400;
            request.ReadWriteTimeout = 1400;
            request.Proxy = null;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                return response.StatusCode == HttpStatusCode.OK;
            }
        }
        catch { return false; }
    }

    private static int GetSupervisorPid()
    {
        try
        {
            string file = Path.Combine(runtimeRoot, "supervisor.pid");
            if (!File.Exists(file)) return 0;
            int pid;
            if (!Int32.TryParse(File.ReadAllText(file).Trim(), out pid)) return 0;
            Process p = Process.GetProcessById(pid);
            return p.HasExited ? 0 : pid;
        }
        catch { return 0; }
    }

    private static void RefreshStatus(bool showBalloon)
    {
        bool healthy = IsCoreHealthy();
        int supervisorPid = GetSupervisorPid();

        statusItem.Text = healthy ? "Core: HEALTHY" : "Core: DOWN / WAITING";
        statusItem.ForeColor = healthy ? Color.FromArgb(76, 190, 120) : Color.FromArgb(230, 172, 55);
        supervisorItem.Text = supervisorPid > 0 ? "Supervisor: RUNNING (PID " + supervisorPid + ")" : "Supervisor: NOT RUNNING";
        supervisorItem.ForeColor = supervisorPid > 0 ? Color.FromArgb(76, 190, 120) : Color.FromArgb(220, 90, 90);

        string tip = healthy ? "SHINO // CONTROL - HEALTHY" : "SHINO // CONTROL - DOWN / WAITING";
        tray.Text = tip.Length <= 63 ? tip : tip.Substring(0, 63);

        if (showBalloon || healthy != lastHealthy)
        {
            tray.BalloonTipTitle = "SHINO // CONTROL";
            tray.BalloonTipText = healthy
                ? "Core HEALTHY - " + healthUrl
                : "Core DOWN / WAITING - supervisor will retry automatically.";
            tray.BalloonTipIcon = healthy ? ToolTipIcon.Info : ToolTipIcon.Warning;
            tray.ShowBalloonTip(2500);
        }
        lastHealthy = healthy;
    }

    private static void OpenUrl()
    {
        try { Process.Start(healthUrl.Replace("/api/state", "")); } catch { }
    }

    private static void RestartCore()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/control/restart");
            request.Method = "POST";
            request.ContentLength = 0;
            request.Timeout = 1800;
            request.Proxy = null;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse()) { }
            tray.BalloonTipTitle = "SHINO // CONTROL";
            tray.BalloonTipText = "Core restart requested. Supervisor will bring it back automatically.";
            tray.BalloonTipIcon = ToolTipIcon.Info;
            tray.ShowBalloonTip(2500);
        }
        catch
        {
            tray.BalloonTipTitle = "SHINO // CONTROL";
            tray.BalloonTipText = "Could not request Core restart.";
            tray.BalloonTipIcon = ToolTipIcon.Warning;
            tray.ShowBalloonTip(2500);
        }
    }

    private static void OpenRuntimeFolder()
    {
        try
        {
            Directory.CreateDirectory(runtimeRoot);
            Process.Start("explorer.exe", "\"" + runtimeRoot + "\"");
        }
        catch { }
    }

    private static void OpenStartupLog()
    {
        try
        {
            if (File.Exists(startupLog)) Process.Start("notepad.exe", "\"" + startupLog + "\"");
            else OpenRuntimeFolder();
        }
        catch { }
    }

    private static void QuitTray()
    {
        tray.Visible = false;
        timer.Stop();
        Application.Exit();
    }

    private static Icon CreateControlIcon()
    {
        Bitmap bmp = new Bitmap(64, 64);
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF rect = new RectangleF(2, 2, 60, 60);
            using (GraphicsPath path = RoundedRect(rect, 15))
            using (LinearGradientBrush bg = new LinearGradientBrush(rect, Color.FromArgb(18, 25, 37), Color.FromArgb(8, 13, 20), 45f))
            using (Pen border = new Pen(Color.FromArgb(42, 57, 80), 2f))
            {
                g.FillPath(bg, path);
                g.DrawPath(border, path);
            }

            PointF[] slash1 = new PointF[] { new PointF(19,44), new PointF(30,18), new PointF(37,18), new PointF(26,44) };
            PointF[] slash2 = new PointF[] { new PointF(31,44), new PointF(42,18), new PointF(49,18), new PointF(38,44) };
            RectangleF goldRect = new RectangleF(19,18,30,26);
            using (LinearGradientBrush gold = new LinearGradientBrush(goldRect, Color.FromArgb(244,207,113), Color.FromArgb(200,148,50), 90f))
            {
                g.FillPolygon(gold, slash1);
                g.FillPolygon(gold, slash2);
            }

            using (Brush cyan = new SolidBrush(Color.FromArgb(101,220,255)))
            using (Pen cyanLine = new Pen(Color.FromArgb(101,220,255), 2.4f))
            {
                cyanLine.StartCap = LineCap.Round;
                cyanLine.EndCap = LineCap.Round;
                g.FillEllipse(cyan, 45, 11, 8, 8);
                g.DrawLine(cyanLine, 14, 49, 46, 49);
            }
        }

        IntPtr handle = bmp.GetHicon();
        Icon icon = (Icon)Icon.FromHandle(handle).Clone();
        DestroyIcon(handle);
        bmp.Dispose();
        return icon;
    }

    private static GraphicsPath RoundedRect(RectangleF bounds, float radius)
    {
        float d = radius * 2f;
        GraphicsPath path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
