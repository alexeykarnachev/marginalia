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
