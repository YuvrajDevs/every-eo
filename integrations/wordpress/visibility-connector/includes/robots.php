<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Rewrites robots.txt so each named crawler is allowed everywhere, without touching rules for other crawlers.
 * - groups that name only that crawler lose their rules (they're replaced by an explicit allow group)
 * - shared groups ("User-agent: A" + "User-agent: B") drop just that crawler's line
 * - a "User-agent: *" block still applies to everyone else; the specific group we add takes precedence for this crawler
 */
function vcon_robots_allow( $robots, array $agents ) {
	$targets = array_map( 'strtolower', $agents );
	$lines   = preg_split( '/\r\n|\r|\n/', $robots );
	$groups  = array();
	$other   = array(); // Sitemap lines and comments outside groups
	$current = null;

	foreach ( $lines as $line ) {
		$trim = trim( preg_replace( '/#.*$/', '', $line ) );
		if ( '' === $trim ) {
			if ( null !== $current && $current['rules'] ) {
				$groups[] = $current;
				$current  = null;
			}
			continue;
		}
		if ( preg_match( '/^user-agent\s*:\s*(.+)$/i', $trim, $m ) ) {
			if ( null === $current || $current['rules'] ) {
				if ( null !== $current ) {
					$groups[] = $current;
				}
				$current = array( 'agents' => array(), 'rules' => array() );
			}
			$current['agents'][] = trim( $m[1] );
			continue;
		}
		if ( preg_match( '/^sitemap\s*:/i', $trim ) ) {
			$other[] = $trim;
			continue;
		}
		if ( null === $current ) {
			$other[] = $trim;
			continue;
		}
		$current['rules'][] = $trim;
	}
	if ( null !== $current ) {
		$groups[] = $current;
	}

	$out = array();
	foreach ( $groups as $g ) {
		$kept = array_values( array_filter( $g['agents'], function ( $a ) use ( $targets ) {
			return ! in_array( strtolower( $a ), $targets, true );
		} ) );
		if ( ! $kept ) {
			continue;
		}
		foreach ( $kept as $a ) {
			$out[] = 'User-agent: ' . $a;
		}
		foreach ( $g['rules'] as $r ) {
			$out[] = $r;
		}
		$out[] = '';
	}
	foreach ( $agents as $a ) {
		$out[] = 'User-agent: ' . $a;
		$out[] = 'Allow: /';
		$out[] = '';
	}
	foreach ( $other as $o ) {
		$out[] = $o;
	}
	return rtrim( implode( "\n", $out ) ) . "\n";
}
