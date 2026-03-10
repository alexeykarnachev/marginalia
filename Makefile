.PHONY: format mypy pyright quality serve

format:
	@echo +ruff check --fix
	@uv run ruff check --fix -q
	@echo +ruff format
	@uv run ruff format

mypy:
	@echo +mypy
	@uv run mypy marginalia scripts

pyright:
	@echo +pyright
	@uv run pyright

quality: format mypy pyright

serve:
	uv run python scripts/server.py start
