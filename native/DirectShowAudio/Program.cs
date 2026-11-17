using DirectShowLib;
using System.Runtime.InteropServices;

namespace WebcamMonitor.DirectShowAudio;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--list")
        {
            foreach (var captureDevice in GetCaptureDevices())
            {
                Console.WriteLine($"{captureDevice.Category}: {captureDevice.Device.Name}");
            }
            return 0;
        }

        if (args.Length == 2 && args[0] == "--pins")
        {
            var requestedDevice = FindCaptureDevice(args[1]);
            if (requestedDevice is null)
            {
                Console.Error.WriteLine($"Video capture device not found: {args[1]}");
                return 3;
            }
            return PrintPins(requestedDevice);
        }

        if (args.Length == 2 && args[0] == "--monitor")
        {
            var audioDevice = FindMatchingAudioDevice(args[1]);
            if (audioDevice is null)
            {
                Console.Error.WriteLine($"No DirectShow audio device matches: {args[1]}");
                return 4;
            }
            return Monitor(audioDevice);
        }

        if (args.Length != 1 || string.IsNullOrWhiteSpace(args[0]))
        {
            Console.Error.WriteLine("Usage: DirectShowAudio.exe <video-device-name> | --list");
            return 2;
        }

        var device = FindCaptureDevice(args[0]);
        if (device is null)
        {
            Console.Error.WriteLine($"Video capture device not found: {args[0]}");
            return 3;
        }

        return Monitor(device);
    }

    private static int Monitor(DsDevice device)
    {
        IGraphBuilder? graph = null;
        ICaptureGraphBuilder2? captureGraph = null;
        IBaseFilter? source = null;
        IMediaControl? mediaControl = null;

        try
        {
            graph = (IGraphBuilder)new FilterGraph();
            captureGraph = (ICaptureGraphBuilder2)new CaptureGraphBuilder2();
            DsError.ThrowExceptionForHR(captureGraph.SetFiltergraph(graph));
            var filterGuid = typeof(IBaseFilter).GUID;
            device.Mon.BindToObject(null, null, ref filterGuid, out var filterObject);
            source = (IBaseFilter)filterObject;
            DsError.ThrowExceptionForHR(graph.AddFilter(source, device.Name));

            // DirectShow chooses the device's audio pin and the default Windows
            // renderer. Driver filters differ: some expose HDMI audio as Capture,
            // others as Preview, and some don't assign a category at all.
            var renderResult = captureGraph.RenderStream(PinCategory.Capture, MediaType.Audio, source, null, null);
            if (renderResult < 0)
            {
                renderResult = captureGraph.RenderStream(PinCategory.Preview, MediaType.Audio, source, null, null);
            }
            if (renderResult < 0)
            {
                renderResult = captureGraph.RenderStream(Guid.Empty, MediaType.Audio, source, null, null);
            }
            if (renderResult < 0)
            {
                var audioType = MediaType.Audio;
                renderResult = captureGraph.FindPin(
                    source,
                    PinDirection.Output,
                    Guid.Empty,
                    audioType,
                    false,
                    0,
                    out var audioPin);
                if (renderResult >= 0)
                {
                    renderResult = graph.Render(audioPin);
                    ReleaseComObject(audioPin);
                }
            }
            DsError.ThrowExceptionForHR(renderResult);

            mediaControl = (IMediaControl)graph;
            DsError.ThrowExceptionForHR(mediaControl.Run());
            Console.WriteLine("DirectShow audio monitoring started.");

            using var shutdown = new ManualResetEventSlim(false);
            Console.CancelKeyPress += (_, eventArgs) =>
            {
                eventArgs.Cancel = true;
                shutdown.Set();
            };
            shutdown.Wait();
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
        finally
        {
            mediaControl?.Stop();
            ReleaseComObject(source);
            ReleaseComObject(captureGraph);
            ReleaseComObject(graph);
        }
    }

    private static IEnumerable<(Guid Category, DsDevice Device)> GetCaptureDevices()
    {
        foreach (var device in DsDevice.GetDevicesOfCat(FilterCategory.VideoInputDevice))
        {
            yield return (FilterCategory.VideoInputDevice, device);
        }
        foreach (var device in DsDevice.GetDevicesOfCat(FilterCategory.AudioInputDevice))
        {
            yield return (FilterCategory.AudioInputDevice, device);
        }
    }

    private static DsDevice? FindCaptureDevice(string name) =>
        GetCaptureDevices()
            .Select(candidate => candidate.Device)
            .FirstOrDefault(candidate => string.Equals(candidate.Name, name, StringComparison.OrdinalIgnoreCase));

    private static DsDevice? FindMatchingAudioDevice(string videoLabel)
    {
        var videoTokens = Tokens(videoLabel);
        return DsDevice.GetDevicesOfCat(FilterCategory.AudioInputDevice)
            .Select(device =>
            {
                var matches = Tokens(device.Name).Intersect(videoTokens).ToArray();
                return new
                {
                    Device = device,
                    Matches = matches,
                    Score = matches.Sum(token => token.Any(char.IsDigit) ? 4 : 1),
                };
            })
            // A model term ("HD60", "4K60" …) is sufficient. Devices without
            // model terms need two independent descriptive words, which avoids
            // routing an arbitrary microphone made by the same manufacturer.
            .Where(candidate => candidate.Matches.Any(token => token.Any(char.IsDigit)) || candidate.Matches.Length >= 2)
            .OrderByDescending(candidate => candidate.Score)
            .Select(candidate => candidate.Device)
            .FirstOrDefault();
    }

    private static HashSet<string> Tokens(string? value) =>
        System.Text.RegularExpressions.Regex.Matches(value?.ToLowerInvariant() ?? string.Empty, "[a-z0-9]{3,}")
            .Select(match => match.Value)
            .Where(token => token is not "audio" and not "capture" and not "camera" and not "device" and not "digital" and not "elgato" and not "input" and not "microphone" and not "sound" and not "usb" and not "video")
            .Where(token => !System.Text.RegularExpressions.Regex.IsMatch(token, "^[0-9a-f]{4}$"))
            .ToHashSet();

    private static int PrintPins(DsDevice device)
    {
        IBaseFilter? source = null;
        IEnumPins? enumerator = null;
        try
        {
            var filterGuid = typeof(IBaseFilter).GUID;
            device.Mon.BindToObject(null, null, ref filterGuid, out var filterObject);
            source = (IBaseFilter)filterObject;
            DsError.ThrowExceptionForHR(source.EnumPins(out enumerator));

            var pins = new IPin[1];
            while (enumerator.Next(1, pins, IntPtr.Zero) == 0)
            {
                var pin = pins[0];
                pin.QueryPinInfo(out var info);
                pin.QueryId(out var pinId);
                Console.WriteLine($"PIN id={pinId}; name={info.name}; direction={info.dir}");

                if (pin.EnumMediaTypes(out var types) == 0)
                {
                    var mediaTypes = new AMMediaType[1];
                    while (types.Next(1, mediaTypes, IntPtr.Zero) == 0)
                    {
                        Console.WriteLine($"  type={mediaTypes[0].majorType}; subtype={mediaTypes[0].subType}");
                        DsUtils.FreeAMMediaType(mediaTypes[0]);
                    }
                    ReleaseComObject(types);
                }

                ReleaseComObject(info.filter);
                ReleaseComObject(pin);
                pins[0] = null!;
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
        finally
        {
            ReleaseComObject(enumerator);
            ReleaseComObject(source);
        }
    }

    private static void ReleaseComObject(object? value)
    {
        if (value is not null && Marshal.IsComObject(value))
        {
            Marshal.ReleaseComObject(value);
        }
    }
}
