//! The tunnels conformance run's Rust client. Until the rows that run it exist, it says only which client it is, so
//! the client image builds the full dependency tree and the run can call it.

fn main() {
    println!("tunnels-rust-client {}", env!("CARGO_PKG_VERSION"));
}
