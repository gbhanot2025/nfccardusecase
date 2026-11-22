"""APDU transport. Hardware lives behind this interface so all tag logic is testable without a reader."""

from __future__ import annotations

from typing import Protocol


class Transport(Protocol):
    def transmit(self, apdu: bytes) -> tuple[bytes, int]:
        """Send one C-APDU; return (response data, SW1SW2 as an int such as 0x9100)."""
        ...


class PcscTransport:
    """A pyscard connection (ACS ACR1252U or any PC/SC reader). pyscard is imported lazily."""

    def __init__(self, connection) -> None:  # smartcard.CardConnection
        self._connection = connection

    def transmit(self, apdu: bytes) -> tuple[bytes, int]:
        data, sw1, sw2 = self._connection.transmit(list(apdu))
        return bytes(data), (sw1 << 8) | sw2


class PcscReader:
    """Waits for tags on a PC/SC reader. Pick the reader whose name contains `name_hint`."""

    def __init__(self, name_hint: str = "ACR1252") -> None:
        try:
            from smartcard.System import readers
        except ImportError as exc:  # pragma: no cover - depends on the operator's machine
            raise RuntimeError('pyscard is not installed: pip install -e ".[reader]"') from exc
        available = readers()
        # The ACR1252U exposes a PICC (contactless) and a SAM interface; we want the PICC one.
        matches = [r for r in available if name_hint.lower() in str(r).lower() and "sam" not in str(r).lower()]
        if not matches:
            names = ", ".join(str(r) for r in available) or "none"
            raise RuntimeError(f"No reader matching {name_hint!r} found (available: {names})")
        self.reader = matches[0]

    def wait_for_tag(self, timeout: float | None = None) -> PcscTransport:  # pragma: no cover - hardware
        from smartcard.CardRequest import CardRequest
        from smartcard.CardType import AnyCardType

        service = CardRequest(timeout=timeout, cardType=AnyCardType(), readers=[self.reader], newcardonly=True)
        card = service.waitforcard()
        card.connection.connect()
        return PcscTransport(card.connection)

    def wait_for_removal(self) -> None:  # pragma: no cover - hardware
        import time

        from smartcard.Exceptions import CardConnectionException, NoCardException

        while True:
            try:
                connection = self.reader.createConnection()
                connection.connect()
                connection.disconnect()
            except (NoCardException, CardConnectionException):
                return
            time.sleep(0.3)
