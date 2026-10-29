<?php
/**
 * Plugin Name:       Visibility Connector
 * Description:       Lets the Visibility platform apply audited SEO/AEO/GEO fixes (structured data, meta descriptions, AI-crawler access) to this site, and roll them back.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * Text Domain:       visibility-connector
 *
 * Every change is stored as a "fix" in one option, applied at render time through WordPress hooks, and removable
 * at any time. Nothing edits theme files or post content. Deactivating the plugin removes all effects at once.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'VCON_VERSION', '0.1.0' );
define( 'VCON_OPTION', 'vcon_fixes' );
define( 'VCON_TYPES', array( 'jsonld', 'meta_description', 'robots_allow' ) );

require_once __DIR__ . '/includes/robots.php';

/** @return array<string, array> */
function vcon_get_fixes() {
	$fixes = get_option( VCON_OPTION, array() );
	return is_array( $fixes ) ? $fixes : array();
}

function vcon_save_fixes( array $fixes ) {
	update_option( VCON_OPTION, $fixes, true );
}

function vcon_yoast_active() {
	return defined( 'WPSEO_VERSION' );
}

/* ---------------------------------------------------------------- REST API */

add_action( 'rest_api_init', 'vcon_register_routes' );

function vcon_register_routes() {
	$ns   = 'visibility/v1';
	$auth = function () {
		return current_user_can( 'manage_options' );
	};

	register_rest_route( $ns, '/status', array(
		'methods'             => 'GET',
		'permission_callback' => $auth,
		'callback'            => 'vcon_rest_status',
	) );
	register_rest_route( $ns, '/resolve', array(
		'methods'             => 'GET',
		'permission_callback' => $auth,
		'callback'            => 'vcon_rest_resolve',
		'args'                => array( 'url' => array( 'required' => true, 'type' => 'string' ) ),
	) );
	register_rest_route( $ns, '/fixes', array(
		array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => function () {
				return rest_ensure_response( array_values( vcon_get_fixes() ) );
			},
		),
		array(
			'methods'             => 'POST',
			'permission_callback' => $auth,
			'callback'            => 'vcon_rest_apply',
		),
	) );
	register_rest_route( $ns, '/fixes/(?P<id>[A-Za-z0-9_-]{1,64})', array(
		'methods'             => 'DELETE',
		'permission_callback' => $auth,
		'callback'            => 'vcon_rest_remove',
	) );
}

function vcon_rest_status() {
	global $wp_version;
	return rest_ensure_response( array(
		'plugin'           => VCON_VERSION,
		'wordpress'        => $wp_version,
		'home'             => home_url( '/' ),
		'yoast'            => vcon_yoast_active(),
		'yoast_version'    => vcon_yoast_active() ? WPSEO_VERSION : null,
		// A real robots.txt file in the web root is served directly and bypasses WordPress, so robots fixes can't apply.
		'robots_file'      => file_exists( ABSPATH . 'robots.txt' ),
		'blog_public'      => (bool) get_option( 'blog_public' ),
		'fixes'            => count( vcon_get_fixes() ),
	) );
}

/** Maps a public URL to what a fix should target: the front page, a post/page ID, or nothing. */
function vcon_resolve_target( $url ) {
	$url  = esc_url_raw( $url );
	$home = untrailingslashit( home_url() );
	$path = untrailingslashit( (string) wp_parse_url( $url, PHP_URL_PATH ) );
	if ( untrailingslashit( $url ) === $home || '' === $path ) {
		return array( 'kind' => 'home' );
	}
	$id = url_to_postid( $url );
	return $id ? array( 'kind' => 'post', 'id' => $id ) : null;
}

function vcon_rest_resolve( WP_REST_Request $req ) {
	$target = vcon_resolve_target( $req->get_param( 'url' ) );
	return $target ? rest_ensure_response( $target ) : new WP_Error( 'vcon_not_found', 'No page on this site matches that URL.', array( 'status' => 404 ) );
}

function vcon_rest_apply( WP_REST_Request $req ) {
	$body = $req->get_json_params();
	if ( ! is_array( $body ) ) {
		return new WP_Error( 'vcon_bad_request', 'Expected a JSON body.', array( 'status' => 400 ) );
	}
	$id      = isset( $body['id'] ) ? (string) $body['id'] : '';
	$type    = isset( $body['type'] ) ? (string) $body['type'] : '';
	$payload = isset( $body['payload'] ) && is_array( $body['payload'] ) ? $body['payload'] : null;
	if ( ! preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $id ) || ! in_array( $type, VCON_TYPES, true ) || null === $payload ) {
		return new WP_Error( 'vcon_bad_request', 'A fix needs an id, a known type and a payload object.', array( 'status' => 400 ) );
	}

	$fix = array( 'id' => $id, 'type' => $type, 'applied_at' => gmdate( 'c' ) );

	if ( 'robots_allow' === $type ) {
		$agents = isset( $payload['agents'] ) && is_array( $payload['agents'] ) ? array_values( array_filter( array_map( 'vcon_clean_agent', $payload['agents'] ) ) ) : array();
		if ( ! $agents ) {
			return new WP_Error( 'vcon_bad_request', 'robots_allow needs at least one user agent.', array( 'status' => 400 ) );
		}
		$fix['agents'] = $agents;
	} else {
		$target = isset( $body['url'] ) ? vcon_resolve_target( (string) $body['url'] ) : ( ! empty( $body['sitewide'] ) ? array( 'kind' => 'site' ) : null );
		if ( ! $target ) {
			return new WP_Error( 'vcon_not_found', 'No page on this site matches that URL.', array( 'status' => 404 ) );
		}
		$fix['target'] = $target;

		if ( 'jsonld' === $type ) {
			$data = isset( $payload['data'] ) ? $payload['data'] : null;
			if ( ! is_array( $data ) || empty( $data['@type'] ) ) {
				return new WP_Error( 'vcon_bad_request', 'jsonld needs payload.data with an @type.', array( 'status' => 400 ) );
			}
			$fix['data'] = $data;
		} else { // meta_description
			$text = isset( $payload['text'] ) ? trim( sanitize_text_field( (string) $payload['text'] ) ) : '';
			if ( '' === $text || strlen( $text ) > 320 ) {
				return new WP_Error( 'vcon_bad_request', 'meta_description needs text up to 320 characters.', array( 'status' => 400 ) );
			}
			if ( 'post' !== $target['kind'] && 'home' !== $target['kind'] ) {
				return new WP_Error( 'vcon_bad_request', 'A meta description applies to one page.', array( 'status' => 400 ) );
			}
			$fix['text'] = $text;
			// With Yoast, write Yoast's own field so its settings screen shows the new value; keep the old one for rollback.
			if ( vcon_yoast_active() && 'post' === $target['kind'] ) {
				$fix['previous'] = get_post_meta( $target['id'], '_yoast_wpseo_metadesc', true );
				update_post_meta( $target['id'], '_yoast_wpseo_metadesc', $text );
				$fix['via'] = 'yoast';
			}
		}
	}

	$fixes        = vcon_get_fixes();
	$replaced     = isset( $fixes[ $id ] ) ? $fixes[ $id ] : null;
	if ( $replaced ) {
		vcon_undo_side_effects( $replaced );
	}
	$fixes[ $id ] = $fix;
	vcon_save_fixes( $fixes );
	return rest_ensure_response( $fix );
}

function vcon_undo_side_effects( array $fix ) {
	if ( 'meta_description' === $fix['type'] && isset( $fix['via'] ) && 'yoast' === $fix['via'] ) {
		if ( '' === (string) $fix['previous'] ) {
			delete_post_meta( $fix['target']['id'], '_yoast_wpseo_metadesc' );
		} else {
			update_post_meta( $fix['target']['id'], '_yoast_wpseo_metadesc', $fix['previous'] );
		}
	}
}

function vcon_rest_remove( WP_REST_Request $req ) {
	$id    = (string) $req['id'];
	$fixes = vcon_get_fixes();
	if ( ! isset( $fixes[ $id ] ) ) {
		return new WP_Error( 'vcon_not_found', 'No fix with that id.', array( 'status' => 404 ) );
	}
	vcon_undo_side_effects( $fixes[ $id ] );
	unset( $fixes[ $id ] );
	vcon_save_fixes( $fixes );
	return rest_ensure_response( array( 'removed' => $id ) );
}

/* ------------------------------------------------------------- Rendering */

function vcon_fix_matches_request( array $target ) {
	if ( 'site' === $target['kind'] ) {
		return true;
	}
	if ( 'home' === $target['kind'] ) {
		return is_front_page() || is_home() && 'posts' === get_option( 'show_on_front' );
	}
	return 'post' === $target['kind'] && is_singular() && (int) get_queried_object_id() === (int) $target['id'];
}

/** @return array[] jsonld fixes that apply to the current page */
function vcon_current_jsonld() {
	$out = array();
	foreach ( vcon_get_fixes() as $fix ) {
		if ( 'jsonld' === $fix['type'] && vcon_fix_matches_request( $fix['target'] ) ) {
			$out[] = $fix['data'];
		}
	}
	return $out;
}

function vcon_encode_jsonld( $data ) {
	// JSON_HEX_TAG turns < and > into < / > so content can never close the script tag.
	return wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP );
}

add_action( 'wp_head', 'vcon_output_head', 1 );

function vcon_output_head() {
	foreach ( vcon_get_fixes() as $fix ) {
		if ( 'meta_description' === $fix['type'] && ! isset( $fix['via'] ) && vcon_fix_matches_request( $fix['target'] ) && ! vcon_yoast_active() ) {
			echo '<meta name="description" content="' . esc_attr( $fix['text'] ) . '" data-vcon="1" />' . "\n";
		}
	}
	// With Yoast, structured data joins Yoast's own graph (see below) instead of adding a second, competing block.
	if ( vcon_yoast_active() ) {
		return;
	}
	foreach ( vcon_current_jsonld() as $data ) {
		echo '<script type="application/ld+json" data-vcon="1">' . vcon_encode_jsonld( $data ) . "</script>\n";
	}
}

/*
 * Yoast SEO builds one schema graph per page. Our Organization data is merged into Yoast's Organization piece
 * (so there's still exactly one Organization), and any other types are appended to the graph.
 */
add_filter( 'wpseo_schema_organization', 'vcon_merge_yoast_organization' );
add_filter( 'wpseo_schema_graph', 'vcon_extend_yoast_graph', 20 );

function vcon_merge_yoast_organization( $piece ) {
	foreach ( vcon_current_jsonld() as $data ) {
		if ( 'Organization' === $data['@type'] && is_array( $piece ) ) {
			foreach ( array( 'sameAs', 'logo', 'description', 'foundingDate', 'legalName', 'contactPoint' ) as $key ) {
				if ( isset( $data[ $key ] ) ) {
					$piece[ $key ] = 'sameAs' === $key && isset( $piece['sameAs'] ) ? array_values( array_unique( array_merge( (array) $piece['sameAs'], (array) $data['sameAs'] ) ) ) : $data[ $key ];
				}
			}
		}
	}
	return $piece;
}

function vcon_extend_yoast_graph( $graph ) {
	if ( ! is_array( $graph ) ) {
		return $graph;
	}
	$has_org = false;
	foreach ( $graph as $node ) {
		if ( isset( $node['@type'] ) && in_array( 'Organization', (array) $node['@type'], true ) ) {
			$has_org = true;
		}
	}
	foreach ( vcon_current_jsonld() as $data ) {
		if ( 'Organization' === $data['@type'] && $has_org ) {
			continue; // merged above
		}
		unset( $data['@context'] );
		$graph[] = $data;
	}
	return $graph;
}

/* ---------------------------------------------------------------- robots.txt */

add_filter( 'robots_txt', 'vcon_filter_robots', 100, 2 );

function vcon_filter_robots( $output, $public ) {
	$agents = array();
	foreach ( vcon_get_fixes() as $fix ) {
		if ( 'robots_allow' === $fix['type'] ) {
			$agents = array_merge( $agents, $fix['agents'] );
		}
	}
	return $agents ? vcon_robots_allow( (string) $output, array_unique( $agents ) ) : $output;
}

function vcon_clean_agent( $agent ) {
	$agent = preg_replace( '/[^A-Za-z0-9._-]/', '', (string) $agent );
	return '' === $agent ? null : substr( $agent, 0, 64 );
}

/* ---------------------------------------------------------------- Admin page */

add_action( 'admin_menu', function () {
	add_options_page( 'Visibility Connector', 'Visibility', 'manage_options', 'visibility-connector', 'vcon_admin_page' );
} );

function vcon_admin_page() {
	$fixes = vcon_get_fixes();
	echo '<div class="wrap"><h1>Visibility Connector</h1>';
	echo '<p>Connect this site from the Visibility dashboard using an <a href="' . esc_url( admin_url( 'profile.php#application-passwords-section' ) ) . '">application password</a> for an administrator account.</p>';
	if ( file_exists( ABSPATH . 'robots.txt' ) ) {
		echo '<div class="notice notice-warning"><p>A robots.txt file exists in your web root, so WordPress (and this plugin) can\'t change it. Edit or remove that file to let crawler-access fixes apply.</p></div>';
	}
	echo '<h2>Applied fixes (' . count( $fixes ) . ')</h2><ul>';
	foreach ( $fixes as $fix ) {
		echo '<li><code>' . esc_html( $fix['type'] ) . '</code> ' . esc_html( $fix['id'] ) . ' — ' . esc_html( $fix['applied_at'] ) . '</li>';
	}
	echo '</ul><p>Deactivating this plugin removes every applied fix immediately.</p></div>';
}
