using DirectShowLib;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace WebcamMonitor.DirectShowAudio;

internal static class Program
{
    private const int DirectShowMutedVolume = -10000;
    private static readonly Guid PcmMediaSubtype = new("00000001-0000-0010-8000-00AA00389B71");

    private sealed record MonitorOptions(string? OutputName, int Volume, bool Muted);
    private sealed record AudioOutput(string Id, string Label);

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

        if (args.Length == 1 && args[0] == "--list-output")
        {
            return PrintAudioOutputDevices();
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

        if (args.Length >= 2 && args[0] == "--monitor")
        {
            var audioDevice = FindMatchingAudioDevice(args[1]);
            if (audioDevice is null)
            {
                Console.Error.WriteLine($"No DirectShow audio device matches: {args[1]}");
                return 4;
            }
            if (!TryParseMonitorOptions(args.Skip(2).ToArray(), out var options, out var error))
            {
                Console.Error.WriteLine(error);
                return 2;
            }
            return Monitor(audioDevice, options);
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

        return Monitor(device, new MonitorOptions(null, 80, false));
    }

    private static int Monitor(DsDevice device, MonitorOptions options)
    {
        if (!string.IsNullOrWhiteSpace(options.OutputName))
        {
            return MonitorWithSelectedWasapiOutput(device, options);
        }

        IGraphBuilder? graph = null;
        ICaptureGraphBuilder2? captureGraph = null;
        IBaseFilter? source = null;
        IMediaControl? mediaControl = null;

        try
        {
            graph = (IGraphBuilder)new FilterGraph();
            captureGraph = (ICaptureGraphBuilder2)new CaptureGraphBuilder2();
            DsError.ThrowExceptionForHR(captureGraph.SetFiltergraph(graph));
            source = BindFilter(device);
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
            var basicAudio = graph as IBasicAudio;
            ApplyVolume(basicAudio, options.Volume, options.Muted);
            Console.WriteLine("DirectShow audio monitoring started.");

            ProcessAudioCommands(options, (volume, muted) => ApplyVolume(basicAudio, volume, muted));
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

    private static bool TryParseMonitorOptions(string[] arguments, out MonitorOptions options, out string error)
    {
        string? outputName = null;
        var volume = 80;
        var muted = false;

        for (var index = 0; index < arguments.Length; index += 2)
        {
            if (index + 1 >= arguments.Length)
            {
                options = new MonitorOptions(null, 80, false);
                error = "Missing value for monitor option.";
                return false;
            }

            var name = arguments[index];
            var value = arguments[index + 1];
            switch (name)
            {
                case "--output":
                    outputName = string.IsNullOrWhiteSpace(value) ? null : value;
                    break;
                case "--volume" when int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var requestedVolume):
                    volume = Math.Clamp(requestedVolume, 0, 100);
                    break;
                case "--muted" when value is "0" or "1":
                    muted = value == "1";
                    break;
                default:
                    options = new MonitorOptions(null, 80, false);
                    error = $"Invalid monitor option: {name}";
                    return false;
            }
        }

        options = new MonitorOptions(outputName, volume, muted);
        error = string.Empty;
        return true;
    }

    private static int PrintAudioOutputDevices()
    {
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            var devices = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)
                .Select(device => new AudioOutput(device.ID, device.FriendlyName))
                .Where(device => !string.IsNullOrWhiteSpace(device.Id) && !string.IsNullOrWhiteSpace(device.Label))
                .OrderBy(device => device.Label, StringComparer.CurrentCultureIgnoreCase)
                .ToArray();
            Console.Write(JsonSerializer.Serialize(devices));
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static IBaseFilter BindFilter(DsDevice device)
    {
        var filterGuid = typeof(IBaseFilter).GUID;
        device.Mon.BindToObject(null!, null!, ref filterGuid, out var filterObject);
        return (IBaseFilter)filterObject;
    }

    private static void ApplyVolume(IBasicAudio? basicAudio, int volume, bool muted)
    {
        if (basicAudio is null) return;
        var directShowVolume = muted || volume == 0
            ? DirectShowMutedVolume
            : (int)Math.Round(2000 * Math.Log10(Math.Clamp(volume, 1, 100) / 100d));
        DsError.ThrowExceptionForHR(basicAudio.put_Volume(directShowVolume));
    }

    private static int MonitorWithSelectedWasapiOutput(DsDevice device, MonitorOptions options)
    {
        IGraphBuilder? graph = null;
        ICaptureGraphBuilder2? captureGraph = null;
        IBaseFilter? source = null;
        IBaseFilter? sampleGrabberFilter = null;
        IBaseFilter? nullRenderer = null;
        IMediaControl? mediaControl = null;
        ISampleGrabber? sampleGrabber = null;
        AMMediaType? connectedMediaType = null;
        WasapiOut? wasapiOut = null;

        try
        {
            using var deviceEnumerator = new MMDeviceEnumerator();
            using var outputDevice = deviceEnumerator.GetDevice(options.OutputName!);

            graph = (IGraphBuilder)new FilterGraph();
            captureGraph = (ICaptureGraphBuilder2)new CaptureGraphBuilder2();
            DsError.ThrowExceptionForHR(captureGraph.SetFiltergraph(graph));
            source = BindFilter(device);
            DsError.ThrowExceptionForHR(graph.AddFilter(source, device.Name));

            sampleGrabber = (ISampleGrabber)new SampleGrabber();
            sampleGrabberFilter = (IBaseFilter)sampleGrabber;
            var requestedMediaType = new AMMediaType
            {
                majorType = MediaType.Audio,
                subType = PcmMediaSubtype,
                formatType = FormatType.WaveEx,
            };
            DsError.ThrowExceptionForHR(sampleGrabber.SetMediaType(requestedMediaType));
            DsError.ThrowExceptionForHR(sampleGrabber.SetBufferSamples(false));
            DsError.ThrowExceptionForHR(sampleGrabber.SetOneShot(false));
            DsError.ThrowExceptionForHR(graph.AddFilter(sampleGrabberFilter, "Audio Sample Grabber"));

            nullRenderer = (IBaseFilter)new NullRenderer();
            DsError.ThrowExceptionForHR(graph.AddFilter(nullRenderer, "Audio Null Renderer"));
            var renderResult = captureGraph.RenderStream(PinCategory.Capture, MediaType.Audio, source, sampleGrabberFilter, nullRenderer);
            if (renderResult < 0)
            {
                renderResult = captureGraph.RenderStream(PinCategory.Preview, MediaType.Audio, source, sampleGrabberFilter, nullRenderer);
            }
            if (renderResult < 0)
            {
                renderResult = captureGraph.RenderStream(Guid.Empty, MediaType.Audio, source, sampleGrabberFilter, nullRenderer);
            }
            DsError.ThrowExceptionForHR(renderResult);

            connectedMediaType = new AMMediaType();
            DsError.ThrowExceptionForHR(sampleGrabber!.GetConnectedMediaType(connectedMediaType));
            if (connectedMediaType.formatPtr == IntPtr.Zero)
            {
                throw new InvalidOperationException("Die Capture-Karte lieferte kein PCM-Audioformat.");
            }

            var sourceFormat = Marshal.PtrToStructure<WaveFormatEx>(connectedMediaType.formatPtr)
                ?? throw new InvalidOperationException("Die Capture-Karte lieferte ein ungültiges Audioformat.");
            if (sourceFormat.wBitsPerSample is not 8 and not 16 and not 24 and not 32 || sourceFormat.nChannels <= 0 || sourceFormat.nSamplesPerSec <= 0)
            {
                throw new InvalidOperationException("Die Capture-Karte lieferte ein nicht unterstütztes PCM-Audioformat.");
            }

            var waveFormat = new WaveFormat(sourceFormat.nSamplesPerSec, sourceFormat.wBitsPerSample, sourceFormat.nChannels);
            var provider = new BufferedWaveProvider(waveFormat)
            {
                BufferDuration = TimeSpan.FromSeconds(2),
                DiscardOnBufferOverflow = true,
            };
            var callback = new AudioBufferCallback(provider);
            DsError.ThrowExceptionForHR(sampleGrabber.SetCallback(callback, 1));

            wasapiOut = new WasapiOut(outputDevice, AudioClientShareMode.Shared, false, 50);
            wasapiOut.Init(provider);
            ApplyWasapiVolume(wasapiOut, options.Volume, options.Muted);
            wasapiOut.Play();

            mediaControl = (IMediaControl)graph;
            DsError.ThrowExceptionForHR(mediaControl.Run());
            Console.WriteLine("DirectShow audio monitoring started.");
            ProcessAudioCommands(options, (volume, muted) => ApplyWasapiVolume(wasapiOut, volume, muted));
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
            wasapiOut?.Stop();
            wasapiOut?.Dispose();
            if (connectedMediaType is not null) DsUtils.FreeAMMediaType(connectedMediaType);
            ReleaseComObject(nullRenderer);
            ReleaseComObject(sampleGrabberFilter);
            ReleaseComObject(source);
            ReleaseComObject(captureGraph);
            ReleaseComObject(graph);
        }
    }

    private static void ProcessAudioCommands(MonitorOptions options, Action<int, bool> apply)
    {
        var currentVolume = options.Volume;
        var muted = options.Muted;
        string? command;
        while ((command = Console.ReadLine()) is not null)
        {
            if (command.Equals("quit", StringComparison.OrdinalIgnoreCase)) break;
            if (command.Equals("mute", StringComparison.OrdinalIgnoreCase))
            {
                muted = true;
                apply(currentVolume, muted);
                continue;
            }
            if (command.Equals("unmute", StringComparison.OrdinalIgnoreCase))
            {
                muted = false;
                apply(currentVolume, muted);
                continue;
            }
            if (command.StartsWith("volume ", StringComparison.OrdinalIgnoreCase) &&
                int.TryParse(command[7..], NumberStyles.Integer, CultureInfo.InvariantCulture, out var requestedVolume))
            {
                currentVolume = Math.Clamp(requestedVolume, 0, 100);
                apply(currentVolume, muted);
            }
        }
    }

    private static void ApplyWasapiVolume(WasapiOut wasapiOut, int volume, bool muted)
    {
        wasapiOut.Volume = muted ? 0f : Math.Clamp(volume, 0, 100) / 100f;
    }

    private sealed class AudioBufferCallback(BufferedWaveProvider provider) : ISampleGrabberCB
    {
        public int SampleCB(double sampleTime, IMediaSample sample) => 0;

        public int BufferCB(double sampleTime, IntPtr buffer, int bufferLength)
        {
            if (buffer == IntPtr.Zero || bufferLength <= 0) return 0;
            var managedBuffer = new byte[bufferLength];
            Marshal.Copy(buffer, managedBuffer, 0, bufferLength);
            provider.AddSamples(managedBuffer, 0, managedBuffer.Length);
            return 0;
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
            device.Mon.BindToObject(null!, null!, ref filterGuid, out var filterObject);
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
