/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import { MetroAlarm } from '../src/native/MetroAlarm';

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

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders correctly on initial load with splash screen', async () => {
  let root: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    root = ReactTestRenderer.create(<App />);
  });
  const textInstances = root!.root.findAllByType('Text' as any);
  const texts = textInstances.map(t => t.props.children).flat().join(' ');
  expect(texts).toContain('Delhi Metro Alarm');
  expect(texts).toContain('Start Your Journey');
});

test('switching between tabs does not cancel or destroy trip state', async () => {
  let root: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    root = ReactTestRenderer.create(<App />);
  });

  const findPressable = (node: any) => {
    let cur = node;
    while (cur) {
      if (typeof cur.props?.onPress === 'function') return cur;
      cur = cur.parent;
    }
    return null;
  };

  // Find "Start Journey Alarm" button on splash screen
  const textNode = root!.root.find(node =>
    typeof node.props?.children === 'string' && node.props.children.includes('Start Journey Alarm')
  );
  expect(textNode).toBeDefined();

  // Start the trip
  await ReactTestRenderer.act(async () => {
    findPressable(textNode)?.props.onPress();
  });

  // Location updates should be active
  expect(MetroAlarm.startLocationUpdates).toHaveBeenCalled();

  // Switch to Planner tab
  const plannerText = root!.root.find(node =>
    typeof node.props?.children === 'string' && node.props.children.includes('Planner')
  );
  expect(plannerText).toBeDefined();
  await ReactTestRenderer.act(async () => {
    findPressable(plannerText)?.props.onPress();
  });

  // Cancel should NOT have been called merely by switching to planner!
  expect(MetroAlarm.stopLocationUpdates).not.toHaveBeenCalled();

  // Switch back to Trip tab
  const tripText = root!.root.find(node => {
    const ch = Array.isArray(node.props?.children)
      ? node.props.children.join('')
      : (node.props?.children?.toString() ?? '');
    return ch.includes('Trip alarm');
  });
  expect(tripText).toBeDefined();
  await ReactTestRenderer.act(async () => {
    findPressable(tripText)?.props.onPress();
  });

  // Trip remains active and running!
  expect(MetroAlarm.stopLocationUpdates).not.toHaveBeenCalled();
});
