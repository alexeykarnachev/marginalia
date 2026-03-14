run:
	xdg-open docs/index.html

serve:
	@if lsof -ti:8228 > /dev/null 2>&1; then \
		echo "Port 8228 is already in use."; \
		read -p "Kill existing server? [y/N] " ans; \
		if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
			kill $$(lsof -ti:8228); \
			echo "Killed."; \
		else \
			echo "Aborted."; \
			exit 1; \
		fi; \
	fi
	python3 -m http.server 8228 -d docs 2>/dev/null & sleep 0.5 && xdg-open http://localhost:8228

# --- Agent testing ---

extract-book:
	@test -n "$(PDF)" || (echo "Usage: make extract-book PDF=path/to/file.pdf" && exit 1)
	node scripts/extract-book.js "$(PDF)" -o "scripts/debug_data/$$(basename $(PDF) .pdf).json"

test-agent:
	@test -n "$(PDF)" || (echo "Usage: make test-agent PDF=path/to/file.pdf [MODEL=...]" && exit 1)
	./scripts/test-agent.sh "$(PDF)" $(MODEL)

experiments:
	node scripts/analyze-experiment.js --list

analyze:
	@test -n "$(EXP)" || (echo "Usage: make analyze EXP=2026-03-14_001" && exit 1)
	node scripts/analyze-experiment.js "$(EXP)"
