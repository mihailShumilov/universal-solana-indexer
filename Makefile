.PHONY: install dev build test lint format migrate docker-up docker-down clean

install:
	npm install

dev:
	npm run dev

build:
	npm run build

test:
	npm run test

test-coverage:
	npm run test:coverage

lint:
	npm run lint

format:
	npm run format

typecheck:
	npm run typecheck

migrate:
	npm run migrate

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f indexer

db-up:
	docker compose up -d postgres

clean:
	rm -rf dist node_modules coverage
