"""
Continuously re-applies simulated GPS location on iOS.

iOS 26+ resets location after a few seconds even with an active DTX session.
This script re-sends the coordinate every 1 second within the same session,
keeping the simulated location locked indefinitely.

Includes internal retry logic: if the DTX session drops, it re-establishes
the connection up to 3 times before exiting (which triggers the Node.js
watchdog for a full process restart).

Usage: python3 ios_location_hold.py <udid> <lat> <lng>

Send SIGTERM or SIGINT to stop.
"""
import asyncio
import signal
import sys

from pymobiledevice3.remote.userspace_tunnel import establish_userspace_rsd
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation


stop_event = asyncio.Event()

MAX_SESSION_RETRIES = 3


def handle_signal(*_):
    stop_event.set()


async def hold_location(udid: str, lat: float, lng: float):
    for session_attempt in range(MAX_SESSION_RETRIES):
        if stop_event.is_set():
            return

        try:
            rsd = await establish_userspace_rsd(serial=udid)
            try:
                async with DvtProvider(rsd) as dvt:
                    async with LocationSimulation(dvt) as loc:
                        # Set once immediately
                        await loc.set(lat, lng)
                        print(f"HOLDING {lat},{lng}", flush=True)

                        # Re-apply every second to prevent iOS 26 from resetting
                        while not stop_event.is_set():
                            try:
                                await asyncio.wait_for(stop_event.wait(), timeout=1.0)
                            except asyncio.TimeoutError:
                                pass

                            if not stop_event.is_set():
                                try:
                                    await loc.set(lat, lng)
                                except (BrokenPipeError, ConnectionResetError, OSError) as e:
                                    print(f"WARN session error during set: {e}", flush=True)
                                    break  # break inner loop, retry session

                        if stop_event.is_set():
                            # Clean exit — restore real GPS
                            try:
                                await loc.clear()
                            except Exception:
                                pass
                            return
            finally:
                try:
                    await rsd.close()
                except Exception:
                    pass

        except Exception as e:
            if stop_event.is_set():
                return
            print(
                f"WARN reconnecting ({session_attempt + 1}/{MAX_SESSION_RETRIES}): {e}",
                flush=True,
            )
            if session_attempt < MAX_SESSION_RETRIES - 1:
                # Wait before retrying — 2s, 4s
                delay = 2 * (session_attempt + 1)
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=delay)
                    return  # stop_event was set during wait
                except asyncio.TimeoutError:
                    pass

    # All internal retries exhausted — exit so Node.js watchdog can do a full restart
    print("ERROR max session retries reached", flush=True)
    sys.exit(1)


def main():
    if len(sys.argv) != 4:
        print("Usage: python3 ios_location_hold.py <udid> <lat> <lng>", file=sys.stderr)
        sys.exit(1)

    udid = sys.argv[1]
    lat = float(sys.argv[2])
    lng = float(sys.argv[3])

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    asyncio.run(hold_location(udid, lat, lng))


if __name__ == "__main__":
    main()
