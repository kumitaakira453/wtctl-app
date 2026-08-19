//! ローカルスタック全体の起動 / 停止（w-start / w-stop 相当）。

use crate::app::ctx::Ctx;
use crate::error::WtResult;
use crate::event::{LogEvent, Sink};

pub fn start(ctx: &Ctx, sink: &Sink) -> WtResult<()> {
    sink(LogEvent::info("スタックを起動します（docker compose start）"));
    ctx.docker.stack_start(sink)?;
    sink(LogEvent::success("スタックを起動しました"));
    Ok(())
}

pub fn stop(ctx: &Ctx, sink: &Sink) -> WtResult<()> {
    sink(LogEvent::info("スタックを停止します（docker compose stop / DB は down しません）"));
    ctx.docker.stack_stop(sink)?;
    sink(LogEvent::success("スタックを停止しました"));
    Ok(())
}
