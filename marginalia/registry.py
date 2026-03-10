"""Service registry with lazy implementation loading and singleton caching."""

import importlib
from typing import TypeVar

T = TypeVar("T")

_registrations: dict[type, str] = {}
_instances: dict[type, object] = {}


def register(interface: type, impl_path: str) -> None:
    """Register a dotted-path implementation for an interface."""
    _registrations[interface] = impl_path


def get(interface: type[T]) -> T:
    """Return the singleton instance for the given interface."""
    if interface in _instances:
        return _instances[interface]  # type: ignore[return-value]

    impl_path = _registrations.get(interface)
    if impl_path is None:
        raise LookupError(f"No implementation registered for {interface}")

    module_path, class_name = impl_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    cls = getattr(module, class_name)
    instance = cls()
    _instances[interface] = instance
    return instance  # type: ignore[no-any-return, return-value]
