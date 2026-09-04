package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mylinear/internal/config"
	"mylinear/internal/router"
)

func main() {
	cfg := config.Load()

	// SIGINT/SIGTERM 触发优雅关闭
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("parse db config: %v", err)
	}
	// pgx 不会自动发现数据库里的自定义枚举类型：单值枚举参数可靠 named type 底层
	// string 的回退机制编码，但 sqlc.arg('statuses')::task_status[] 这类数组参数
	// 在未注册数组类型时会报 "cannot find encode plan"。逐连接注册枚举及其数组类型。
	poolCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		types, err := conn.LoadTypes(ctx, []string{
			"task_status", "_task_status",
			"project_status", "_project_status",
			"label_scope", "_label_scope",
			"view_entity", "_view_entity",
		})
		if err != nil {
			return fmt.Errorf("load enum types: %w", err)
		}
		conn.TypeMap().RegisterTypes(types)
		return nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		log.Fatalf("create db pool: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("ping db: %v", err)
	}
	log.Println("connected to database")

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router.New(pool),
	}

	go func() {
		log.Printf("server listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
	log.Println("server stopped")
}
