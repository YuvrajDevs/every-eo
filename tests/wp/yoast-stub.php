<?php
/*
 * Minimal stand-in for Yoast SEO's public surface used by the connector: the WPSEO_VERSION constant, the
 * _yoast_wpseo_metadesc post meta, and the wpseo_schema_graph / wpseo_schema_organization filters.
 * Real Yoast can't be downloaded in the test sandbox; this models the documented filter contract only.
 */
define( 'WPSEO_VERSION', '23.0-stub' );
add_action( 'wp_head', function () {
	$desc = is_singular() ? get_post_meta( get_queried_object_id(), '_yoast_wpseo_metadesc', true ) : '';
	if ( $desc ) {
		echo '<meta name="description" content="' . esc_attr( $desc ) . '" class="yoast-seo-meta-tag" />' . "\n";
	}
	$org   = apply_filters( 'wpseo_schema_organization', array( '@type' => 'Organization', '@id' => home_url( '/#organization' ), 'name' => get_bloginfo( 'name' ), 'url' => home_url( '/' ) ) );
	$graph = apply_filters( 'wpseo_schema_graph', array( array( '@type' => 'WebSite', '@id' => home_url( '/#website' ) ), $org ) );
	echo '<script type="application/ld+json" class="yoast-schema-graph">' . wp_json_encode( array( '@context' => 'https://schema.org', '@graph' => $graph ) ) . "</script>\n";
}, 2 );
