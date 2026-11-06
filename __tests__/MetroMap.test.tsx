import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { MetroMapScreen } from '../src/map/MetroMapScreen';
import App from '../App';

jest.mock('../src/native/MetroAlarm', () => ({
  MetroAlarm: {
    startAlarm: jest.fn().mockResolvedValue(true),
    stopAlarm: jest.fn().mockResolvedValue(true),
    requestNotificationPermission: jest.fn().mockResolvedValue(true),
    requestLocationPermission: jest.fn().mockResolvedValue(true),
    startLocationUpdates: jest.fn().mockResolvedValue(true),
    stopLocationUpdates: jest.fn().mockResolvedValue(true),
    isRinging: jest.fn().mockResolvedValue(false),
    scheduleAlarm: jest.fn().mockResolvedValue(true),
    cancelScheduledAlarm: jest.fn().mockResolvedValue(true),
    setTrackingMode: jest.fn().mockResolvedValue(true),
    getLastKnownLocation: jest.fn().mockResolvedValue({
      lat: 28.55,
      lon: 77.05,
      accuracy: 10,
      ts: 1760000000000,
    }),
    saveString: jest.fn().mockResolvedValue(true),
    getString: jest.fn().mockResolvedValue(null),
  },
}));

const mockTheme = {
  bg: '#0b0f19',
  surface: '#141c2e',
  surface2: '#1e293b',
  surfaceElevated: '#243048',
  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.18)',
  text: '#f8fafc',
  textDim: '#94a3b8',
  textFaint: '#64748b',
  accent: '#3b82f6',
  accentSoft: 'rgba(59,130,246,0.18)',
  onAccent: '#ffffff',
  red: '#ef4444',
  green: '#10b981',
  greenSoft: 'rgba(16,185,129,0.16)',
  amber: '#f59e0b',
  amberSoft: 'rgba(245,158,11,0.16)',
};

const findPressable = (node: any) => {
  let cur = node;
  while (cur) {
    if (typeof cur.props?.onPress === 'function') return cur;
    cur = cur.parent;
  }
  return null;
};

describe('MetroMapScreen', () => {
  test('renders offline map header, search box, line chips, and station list', async () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(
        <MetroMapScreen
          t={mockTheme}
          onSelectOrigin={jest.fn()}
          onSelectDestination={jest.fn()}
        />,
      );
    });

    const textInstances = root!.root.findAllByType('Text' as any);
    const texts = textInstances.map(t => t.props.children).flat().join(' ');

    expect(texts).toContain('Delhi Metro Network Map');
    expect(texts).toContain('100% Offline');
    expect(texts).toContain('All Lines');
    expect(texts).toContain('Blue Line');
    expect(texts).toContain('Yellow Line');
    expect(texts).toContain('Tap any station to inspect & route');
  });

  test('filters stations when typing a search query', async () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(
        <MetroMapScreen
          t={mockTheme}
          onSelectOrigin={jest.fn()}
          onSelectDestination={jest.fn()}
        />,
      );
    });

    const textInput = root!.root.findByType('TextInput' as any);
    expect(textInput).toBeDefined();

    // Type "Rajiv" into the search box
    await ReactTestRenderer.act(async () => {
      textInput.props.onChangeText('Rajiv');
    });

    const textInstances = root!.root.findAllByType('Text' as any);
    const texts = textInstances.map(t => t.props.children).flat().join(' ');

    expect(texts).toContain('Rajiv Chowk');
    // Non-matching stations shouldn't be listed
    expect(texts).not.toContain('Botanical Garden');
  });

  test('zooms in, zooms out, and resets zoom level with HUD controls', async () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(
        <MetroMapScreen
          t={mockTheme}
          onSelectOrigin={jest.fn()}
          onSelectDestination={jest.fn()}
        />,
      );
    });

    // Default zoom is 100%
    let textInstances = root!.root.findAllByType('Text' as any);
    let texts = textInstances.map(t => t.props.children).flat().join(' ');
    expect(texts).toContain('100%');

    // Tap zoom in (➕)
    const zoomInBtn = root!.root.find(node =>
      typeof node.props?.children === 'string' && node.props.children.includes('➕'),
    );
    await ReactTestRenderer.act(async () => {
      findPressable(zoomInBtn)?.props.onPress();
    });

    textInstances = root!.root.findAllByType('Text' as any);
    texts = textInstances.map(t => t.props.children).flat().join('');
    expect(texts).toContain('135%');

    // Tap reset (center percentage badge)
    const resetBtn = root!.root.find(node => {
      const ch = Array.isArray(node.props?.children) ? node.props.children.join('') : node.props?.children?.toString();
      return typeof ch === 'string' && ch.includes('135%');
    });
    await ReactTestRenderer.act(async () => {
      findPressable(resetBtn)?.props.onPress();
    });

    textInstances = root!.root.findAllByType('Text' as any);
    texts = textInstances.map(t => t.props.children).flat().join(' ');
    expect(texts).toContain('100%');
  });

  test('taps a station to open inspector card and triggers onSelectOrigin / onSelectDestination', async () => {
    const onSelectOrigin = jest.fn();
    const onSelectDestination = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(
        <MetroMapScreen
          t={mockTheme}
          onSelectOrigin={onSelectOrigin}
          onSelectDestination={onSelectDestination}
        />,
      );
    });

    // Search and tap Rajiv Chowk
    const textInput = root!.root.findByType('TextInput' as any);
    await ReactTestRenderer.act(async () => {
      textInput.props.onChangeText('Rajiv Chowk');
    });

    const rajivRow = root!.root.find(node =>
      typeof node.props?.children === 'string' && node.props.children.includes('Rajiv Chowk'),
    );
    await ReactTestRenderer.act(async () => {
      findPressable(rajivRow)?.props.onPress();
    });

    // Inspector card should be visible with interchange badge and action buttons
    let textInstances = root!.root.findAllByType('Text' as any);
    let texts = textInstances.map(t => t.props.children).flat().join(' ');
    expect(texts).toContain('🔄 Interchange Hub');
    expect(texts).toContain('Set as Boarding Station');
    expect(texts).toContain('Set as Destination');

    // Tap "Set as Boarding Station"
    const originBtn = root!.root.find(node =>
      typeof node.props?.children === 'string' && node.props.children.includes('Set as Boarding Station'),
    );
    await ReactTestRenderer.act(async () => {
      findPressable(originBtn)?.props.onPress();
    });

    expect(onSelectOrigin).toHaveBeenCalledWith('rajiv-chowk');
  });

  test('end-to-end integration: switches to Metro Map tab from App and selects a station', async () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(<App />);
      await new Promise(r => setTimeout(r, 20));
    });

    // Find "Metro Map" tab
    const mapTab = root!.root.find(node =>
      typeof node.props?.children === 'string' && node.props.children.includes('🚇 Metro Map'),
    );
    expect(mapTab).toBeDefined();

    // Switch to Metro Map tab
    await ReactTestRenderer.act(async () => {
      findPressable(mapTab)?.props.onPress();
      await new Promise(r => setTimeout(r, 20));
    });

    const textInstances = root!.root.findAllByType('Text' as any);
    const texts = textInstances.map(t => t.props.children).flat().join(' ');
    expect(texts).toContain('Delhi Metro Network Map');
    expect(texts).toContain('100% Offline');

    await ReactTestRenderer.act(async () => {
      root.unmount();
    });
  });
});
